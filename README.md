# CrewAI Desktop

Local-first CrewAI workspace for running multi-agent chat flows on your own machine.

The current repository is a Go backend plus a React/Vite frontend and a Go CLI. The backend owns persistence, runtime discovery, chat execution, SSE streaming, and handoff orchestration. The frontend is a browser app that talks to the backend over HTTP. Electron packaging is not wired in this tree yet; the current local development path is backend + frontend.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ React frontend (frontend/)                                  │
│ Vite + React 18                                             │
│                                                             │
│ App.jsx                                                     │
│ ├── Sidebar.jsx       project/chat navigation               │
│ ├── NewTaskRoute.jsx  create project/chat entry point       │
│ ├── TaskView.jsx      chat transcript, composer, SSE client │
│ └── CrewRoute.jsx     agents, skills, runtimes management   │
│                                                             │
│ api.js uses fetch + EventSource against /api                │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP/SSE, dev proxy to :8080
┌──────────────────────────────┴──────────────────────────────┐
│ Go backend (cmd/crewai-server)                              │
│                                                             │
│ internal/httpapi  REST + SSE routes                         │
│ internal/app      business logic and chat execution          │
│ internal/store    mutex-protected JSON/JSONL file storage    │
│ internal/runtime  runtime scanner and execution interface    │
│ internal/backendagent                                      │
│                   provider adapters for local agent CLIs     │
│ internal/broker   in-process pub/sub for SSE fan-out         │
│                                                             │
│ State directory: ~/.crewai by default                       │
└─────────────────────────────────────────────────────────────┘

Go CLI:
  cmd/crewai-cli -> bin/crewai-cli, a terminal API client for the backend.
```

## Current Product Model

The app exposes these main resources:

- **Runtime**: a local AI execution environment, such as Codex or Claude Code.
- **Agent**: an AI persona with instruction, runtime, model, and attached skills.
- **Skill**: a markdown skill directory stored under the CrewAI state directory.
- **Project**: a named workspace tied to a filesystem directory.
- **Chat**: an append-only conversation inside a project, led by one main agent but able to hand off to other agents.
- **Event**: one timeline item in a chat, persisted and streamed as `message`, `thinking`, `tool_call`, or `tool_call_result`.

There is no separate task/subtask backend model in the current implementation. The frontend still uses "New Task" language in places, but the backend resource is a chat session.

## Backend Packages

| Package | Responsibility |
|---|---|
| `cmd/crewai-server` | HTTP server entrypoint. Reads env, creates `httpapi.Server`, listens on `PORT`. |
| `cmd/crewai-cli` | CLI entrypoint. Calls `internal/cli.Run`. |
| `internal/httpapi` | REST handlers and chat SSE streaming endpoint. |
| `internal/app` | Business logic for runtimes, agents, skills, projects, chats, posting messages, cancellation, and handoff loops. |
| `internal/store` | File-backed persistence using JSON and JSONL under `CREWAI_STATE_DIR`. |
| `internal/runtime` | Runtime scan/execution interfaces plus local scanner and real/mock engines. |
| `internal/backendagent` | Multica-derived adapters for local coding-agent CLIs. |
| `internal/broker` | In-process pub/sub for streaming chat events to SSE clients. |
| `internal/model` | Shared data types and summary/handoff helpers. |
| `internal/mention` | Mention parsing helpers. |
| `internal/id` | UUID-style ID generation. |

## Frontend Packages

The frontend is in `frontend/` and uses React 18 with Vite.

| File | Responsibility |
|---|---|
| `frontend/src/App.jsx` | Root state, routing, data loading, backend availability. |
| `frontend/src/Sidebar.jsx` | Project/chat navigation and primary sections. |
| `frontend/src/NewTaskRoute.jsx` | Project/chat creation flow. |
| `frontend/src/TaskView.jsx` | Chat transcript, composer, event rendering, SSE reconnect. |
| `frontend/src/CrewRoute.jsx` | Agents, skills, and runtimes tabs. |
| `frontend/src/api.js` | Fetch wrappers and `streamChatEvents()` SSE helper. |
| `frontend/src/utils.js` | Event mapping, display helpers, deterministic agent colors. |
| `frontend/src/components.jsx` | Shared UI atoms. |
| `frontend/vite.config.js` | Dev server on port `3000`, proxying `/api` to backend port `8080`. |

## State Layout

By default the backend stores state in:

```text
~/.crewai
```

Override it with `CREWAI_STATE_DIR`.

Current storage layout:

```text
~/.crewai/
  runtimes.json

  agents/
    agent-<uuid>/
      config.json

  skills/
    registry.json
    skill-<uuid>/
      SKILL.md
      ...

  projects/
    registry.jsonl
    proj-<uuid>/
      project.json
      chats.jsonl

  chats/
    chat-<uuid>/
      chat.json
      events.jsonl
      summary.md

  runtime-manifests/
```

Important persistence rules:

- `events.jsonl` is the source of truth for chat history.
- `summary.md` is rebuilt before switching to a different agent runtime session.
- `runtimes.json` is a snapshot of scanned runtimes.
- Project and chat indexes are JSONL projections used for list views.

## Chat Execution Flow

1. The frontend or CLI posts to `POST /api/chat/sessions/{id}/messages`.
2. The backend loads the chat, target agent, runtime record, and project.
3. If another response is already streaming for that chat, the backend returns a conflict.
4. The user message is appended to `events.jsonl` and published to SSE subscribers.
5. A goroutine starts `runChat`.
6. If the target agent changed from the last runtime session, `summary.md` is rebuilt from the event log.
7. `internal/runtime.RealEngine` invokes the selected backend agent adapter.
8. Runtime stream events are appended to `events.jsonl` and published through `internal/broker`.
9. When the runtime finishes, `chat.json` is updated with `last_runtime_session`.
10. If the final assistant message contains `^<CREWAI_HANDOFF>agent-id</CREWAI_HANDOFF>`, the backend automatically starts the next response with that agent.
11. The stream ends with an SSE `done` event.

## Runtime Support

The current local scanner detects:

- `claude`
- `codex`

It checks executables from PATH or from environment overrides:

| Provider | Binary env | Model env |
|---|---|---|
| Claude | `CREWAI_CLAUDE_PATH` or legacy `MULTICA_CLAUDE_PATH` | `CREWAI_CLAUDE_MODEL` or legacy `MULTICA_CLAUDE_MODEL` |
| Codex | `CREWAI_CODEX_PATH` or legacy `MULTICA_CODEX_PATH` | `CREWAI_CODEX_MODEL` or legacy `MULTICA_CODEX_MODEL` |

`internal/backendagent` contains adapters for more providers (`copilot`, `opencode`, `openclaw`, `hermes`, `gemini`, `pi`, `cursor`, `kimi`, `kiro`), but the default scanner currently focuses on Claude and Codex.

The machine must already have the target local CLIs installed and authenticated.

## HTTP API

Default base URL:

```text
http://127.0.0.1:8080
```

Core endpoints:

```text
GET  /health

GET  /api/runtimes
POST /api/runtimes/rescan
GET  /api/runtimes/{id}
POST /api/runtimes/{id}/update

GET  /api/agents
POST /api/agents
GET  /api/agents/{id}
PUT  /api/agents/{id}
POST /api/agents/{id}/archive
POST /api/agents/{id}/restore
PUT  /api/agents/{id}/skills

GET    /api/skills
POST   /api/skills
GET    /api/skills/{id}
PUT    /api/skills/{id}
DELETE /api/skills/{id}
GET    /api/skills/{id}/files
PUT    /api/skills/{id}/files
DELETE /api/skills/{id}/files/{fileId}

GET    /api/projects
POST   /api/projects
GET    /api/projects/{id}
PUT    /api/projects/{id}
DELETE /api/projects/{id}
GET    /api/projects/{id}/chats

POST   /api/chat/sessions
GET    /api/chat/sessions
GET    /api/chat/sessions/{id}
PUT    /api/chat/sessions/{id}
DELETE /api/chat/sessions/{id}
POST   /api/chat/sessions/{id}/messages
GET    /api/chat/sessions/{id}/events
POST   /api/chat/sessions/{id}/cancel
```

Chat events support both JSON replay and SSE follow:

```text
GET /api/chat/sessions/{id}/events?after=0
GET /api/chat/sessions/{id}/events?after=0&follow=1
```

SSE event names:

- `chat.event`
- `done`
- `error`

## CLI

Build first:

```bash
make build
```

Run commands:

```bash
./bin/crewai-cli runtimes rescan
./bin/crewai-cli runtimes list
./bin/crewai-cli agents list
./bin/crewai-cli projects list
```

Override backend URL:

```bash
./bin/crewai-cli --base-url http://127.0.0.1:18766 runtimes list
```

or:

```bash
CREWAI_BASE_URL=http://127.0.0.1:18766 ./bin/crewai-cli runtimes list
```

Interactive chat:

```bash
./bin/crewai-cli chat --session <chat-id> --agent <agent-id>
```

More CLI examples are in [`docs/cli.md`](docs/cli.md).

## Running Locally

### Requirements

- Go `1.26.1`
- Node.js `18+`
- npm
- local `codex` CLI for Codex runtime support
- local `claude` CLI for Claude runtime support

### Build Backend And CLI

```bash
make build
```

Build artifacts:

```text
bin/crewai-server
bin/crewai-cli
```

### Start Backend

```bash
CREWAI_STATE_DIR="$HOME/.crewai" PORT=8080 ./bin/crewai-server
```

Or from source:

```bash
go run ./cmd/crewai-server
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Backend HTTP listen port. |
| `CREWAI_STATE_DIR` | `~/.crewai` | Root directory for persisted state. |
| `CREWAI_RUNTIME_SCAN_DIR` | `$CREWAI_STATE_DIR/runtime-manifests` | Runtime manifest scan directory. |
| `CREWAI_CLAUDE_PATH` | `claude` | Optional Claude executable override. |
| `CREWAI_CLAUDE_MODEL` | empty | Optional default Claude model metadata. |
| `CREWAI_CODEX_PATH` | `codex` | Optional Codex executable override. |
| `CREWAI_CODEX_MODEL` | empty | Optional default Codex model metadata. |

### Start Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

The Vite dev server proxies `/api` to `http://localhost:8080`.

## Common Development Commands

```bash
make fmt       # gofmt cmd/internal/test-utils
make test      # go test ./...
make build     # build server and CLI into bin/
make e2e       # run API end-to-end suite
make clean     # remove local build artifacts
```

Frontend:

```bash
cd frontend
npm run build
npm run preview
```

## End-To-End Tests

Backend API e2e:

```bash
./test-utils/api-e2e.sh all
```

The suite uses isolated state under `/tmp/crewai-api-e2e` by default and expects authenticated local `codex` and `claude` CLIs for real runtime coverage.

More detail: [`docs/api-e2e.md`](docs/api-e2e.md).

## Notes For New Contributors

- The current frontend says "task" in some UI labels, but the backend entity is `chat`.
- Handoff is controlled by the exact marker `^<CREWAI_HANDOFF>agent-uuid</CREWAI_HANDOFF>` in assistant output.
- Mentions use markdown link syntax like `[@Aria](mention://agent/<uuid>)`; mentions do not change the target agent.
- The backend does not stream token deltas. It streams complete event blocks.
- The source tree has `mocks/static/` with older prototype assets for visual reference.
- Electron shell work is still future/currently external to this tree; do not expect `npm run electron` or a packaged app target in this directory.
