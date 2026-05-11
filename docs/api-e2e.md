# API-Level End-to-End Test Design

## Goal

This suite validates the backend as a file-backed API service, without any
frontend involved. The purpose is not just "one happy path works", but that the
API contract is friendly to a frontend:

- list/get responses reflect persisted state immediately
- on-disk state matches API responses
- chat/runtime state survives a backend restart
- Claude Code and Codex both work through the real runtime bridge
- handoff is observable through both persisted events and side effects

## Runtime Preconditions

The machine running this suite must already have authenticated local CLIs for:

- `codex`
- `claude`

`POST /api/runtimes/rescan` uses the multica-derived local scan path now wired
into this repo. The suite expects exactly two detected runtimes today:

- `codex`
- `claude`

## Test Commands

```bash
./test-utils/api-e2e.sh reset
./test-utils/api-e2e.sh setup
./test-utils/api-e2e.sh run
./test-utils/api-e2e.sh destroy
```

Or run the whole suite in one go:

```bash
./test-utils/api-e2e.sh all
```

Artifacts are written under `/tmp/crewai-api-e2e` by default. Override with
`CREWAI_API_E2E_ROOT=...` if needed.

## Scenario Outline

### 1. Reset application state

The script deletes the isolated state root, recreates an empty workspace, and
verifies the following paths do **not** exist before the backend starts:

- `state/runtimes.json`
- `state/agents`
- `state/skills`
- `state/projects`
- `state/chats`

It also creates a workspace sentinel file:

- `workspace/.crewai-e2e-signal.txt`

### 2. Rescan runtimes

After the backend starts, the suite calls:

- `POST /api/runtimes/rescan`
- `GET /api/runtimes`
- `GET /api/runtimes/codex`
- `GET /api/runtimes/claude`

Assertions:

- runtime list length is `2`
- `codex` and `claude` are both `available`
- both records have non-empty `binary_path`
- `state/runtimes.json` exists
- resource directories for agents/skills/projects/chats still do **not** exist

### 3. Register a project directory

The suite intentionally creates the project **before** wiring a main agent, to
mirror a frontend-first "register workspace, configure later" flow:

- `POST /api/projects`
- `GET /api/projects`
- `GET /api/projects/{id}`

Assertions:

- project list length is `1`
- the single project has the expected `id`, `name`, `workdir`
- `main_agent_id` is empty at this stage
- `state/projects/registry.jsonl` exists
- `state/projects/proj-{id}` contains exactly:
  - `project.json`
  - `chats.jsonl`
- `state/chats` still does **not** exist yet

### 4. Create the main agent

The suite creates a Codex-backed main agent:

- `POST /api/agents`
- `GET /api/agents`
- `GET /api/agents/{id}`

Assertions:

- agent list length is `1`
- the single agent points at runtime `codex`
- `state/agents/agent-{id}` contains exactly:
  - `config.json`

### 5. Create and mutate a skill

The suite exercises both the skill record and the skill file endpoints:

- `POST /api/skills`
- `GET /api/skills`
- `GET /api/skills/{id}`
- `PUT /api/skills/{id}`
- `PUT /api/skills/{id}/files`
- `GET /api/skills/{id}/files`
- `DELETE /api/skills/{id}/files/{fileId}`

Assertions:

- skill list length is `1`
- skill path equals `state/skills/skill-{id}`
- `state/skills/registry.json` exists
- `state/skills/skill-{id}` initially contains exactly:
  - `SKILL.md`
- after adding `notes.md`, file list length becomes `2`
- after deleting `notes.md`, file list length returns to `1`

### 6. Attach the skill and wire the project to the main agent

The suite then exercises update-style resource wiring:

- `PUT /api/agents/{id}/skills`
- `PUT /api/projects/{id}`

Assertions:

- agent `skill_ids` contains the created skill
- project `main_agent_id` becomes the main agent id
- project rename/update is reflected in the response

### 7. Create the worker and Claude agents

Two more agents are created:

- a second Codex-backed worker agent for handoff
- a Claude-backed reviewer agent for provider coverage

Assertions:

- `GET /api/agents` returns exactly `3` agents
- worker runtime is `codex`
- reviewer runtime is `claude`

### 8. Create the first chat and verify resource listings

The suite creates a "resume chat":

- `POST /api/chat/sessions`
- `GET /api/projects/{id}/chats`
- `GET /api/chat/sessions?project_id={id}`
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/{id}`
- `PUT /api/chat/sessions/{id}`

Assertions:

- project chat list length is `1`
- project-filtered chat list length is `1`
- global chat list length is `1`
- `state/chats/chat-{id}` contains exactly:
  - `chat.json`
  - `events.jsonl`
  - `summary.md`
- newly created chat starts with:
  - `current_agent_id == main_agent_id`
  - `stream.status == idle`

This step specifically covers a frontend-facing expectation that
`GET /api/chat/sessions` without `project_id` returns all persisted chats.

### 9. Run Codex twice and verify session resume

The suite posts two messages to the first chat through the main Codex agent:

1. Read `.crewai-e2e-signal.txt` and echo its exact contents
2. Reply with exact text `SECOND_OK`

Assertions:

- first run persists a `tool_call` event
- first run output contains `API_E2E_SIGNAL`
- both Codex turns complete successfully
- `last_runtime_session.session_id` is non-empty after turn one
- the second turn reuses the exact same session id

### 10. Switch to Claude and verify SSE replay/follow

The suite posts a Claude-targeted message to the same chat, then reads:

- `GET /api/chat/sessions/{id}/events?after=0&follow=1`

Assertions:

- SSE output contains `event: chat.event`
- SSE output contains a `tool_call`
- SSE output contains `CLAUDE_OK`
- SSE output terminates with `event: done`
- chat `current_agent_id` becomes the Claude agent
- `summary.md` contains earlier Codex user context and assistant output

This confirms real provider invocation, provider stream parsing, persisted event
replay, and live SSE follow.

### 11. Trigger handoff and verify downstream side effects

The suite creates a second chat, then instructs the main Codex agent to:

- emit a plain-language instruction for another agent
- append an exact `^<CREWAI_HANDOFF>...</CREWAI_HANDOFF>` marker

The worker Codex agent must then, after the handoff:

- read `.crewai-e2e-signal.txt`
- write `.crewai-handoff-result.txt` with exact content `HANDOFF_OK`

Assertions:

- handoff marker exists in persisted `events.jsonl`
- `summary.md` keeps the worker instruction but strips the marker
- chat `current_agent_id` becomes the worker agent
- `workspace/.crewai-handoff-result.txt` exists with exact expected content
- file `ctime` is later than the persisted handoff-event timestamp

That final timestamp check guards against false positives where the file was
created earlier or by the wrong step.

### 12. Restart the backend and verify reload behavior

The suite stops the backend and starts it again **without resetting state**.
Then it re-runs list/get calls for runtimes, projects, agents, skills, chats,
and chat events.

Assertions:

- project count remains `1`
- agent count remains `3`
- skill count remains `1`
- global chat count remains `2`
- project chat count remains `2`
- first chat still points at the Claude agent
- second chat still points at the worker agent
- persisted runtime session id for the first chat survives restart
- persisted events survive restart
- handoff marker is still present in persisted chat history

If any of these fail after restart, that indicates improper in-memory state
coupling or incomplete disk persistence.

## Evidence Files

The script keeps named artifacts for each phase, including:

- runtime snapshots
- project/agent/skill/chat create/list/get/update responses
- SSE output
- persisted summaries
- final restart verification snapshots
- `server.log`

These artifacts are intended to make API regressions debuggable without any
frontend attached.
