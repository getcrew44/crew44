# API-Level End-to-End Test Design

## Scope

This test plan validates the backend-only flow described in `PLAN.md`:

- runtime inventory rescan from local manifest files
- agent / skill / project / chat CRUD on file-backed storage
- chat message submission through HTTP APIs
- event replay and SSE follow on `/api/chat/sessions/{id}/events`
- summary rebuild when agent context changes
- automatic handoff to another agent
- missing-runtime conflict after rescan

No frontend rendering or frontend tests are included.

## Runtime Strategy

Runtime discovery is implemented as a manifest scan of `*.crewai-runtime.json`.

Reason:

- it keeps `POST /api/runtimes/rescan` deterministic
- it is easy to exercise in CI and local shell scripts
- it avoids provider-specific auto-detection heuristics in the first implementation

The API e2e flow uses the built-in `mock` provider. It emits deterministic `thinking`, `tool_call`, `tool_call_result`, and `message` events, and supports scripted directives embedded in user input:

- `/slow`
- `/tool`
- `/handoff:<agent-id>`

## Main Scenario

1. Start `crewai-server` with isolated `CREWAI_STATE_DIR` and `CREWAI_RUNTIME_SCAN_DIR`.
2. Write a `mock` runtime manifest and call `POST /api/runtimes/rescan`.
3. Create:
   - one skill
   - two agents bound to the mock runtime
   - one project
   - one chat session
4. Send an initial message to agent A and wait until the chat becomes idle.
5. Send a second message to agent A with `/slow /tool /handoff:<agent-b-id>`.
6. Read `/api/chat/sessions/{id}/events?after=0&follow=1` as SSE and verify:
   - `chat.event` frames exist
   - `tool_call` is present
   - `done` is emitted
7. Verify persisted state:
   - `summary.md` exists
   - `summary.md` does not contain the raw handoff marker
   - chat `current_agent_id` becomes agent B
8. Remove the runtime manifest, rescan, and confirm a new message returns `409`.

## Expected Artifacts

The script stores evidence under a temp root directory:

- `server.log`
- `runtimes.json`
- `skill.json`
- `agent-a.json`
- `agent-b.json`
- `project.json`
- `chat.json`
- `chat-after-handoff.json`
- `events.sse`
- `summary.md`
- negative-path response payloads

## Execution

```bash
./test-utils/api-e2e.sh setup
./test-utils/api-e2e.sh run
./test-utils/api-e2e.sh destroy
```

Or run the whole flow at once:

```bash
./test-utils/api-e2e.sh all
```
