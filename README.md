# CrewAI Desktop

Local-first CrewAI workspace for running multi-agent chat flows on your own machine.

This repository is structured as a standard Electron/Vite app at the top level, with the Go HTTP backend isolated in `daemon/`. Browser development uses Vite plus the daemon's HTTP API. Electron development and packaged apps launch the daemon automatically, choose a local port, generate an in-memory bearer token, and pass the backend config to the renderer through preload.

## Layout

```text
.
├── electron/              Electron main process, preload, app assets, scripts
├── src/                   React renderer source
├── public/                Renderer static assets
├── daemon/                Go module for daemon, API tests, internals
│   ├── cmd/crewai-daemon  HTTP daemon entrypoint
│   ├── internal/          app, httpapi, store, runtime, agent adapters
│   └── test-utils/jsonq   helper used by e2e scripts
├── docs/                  Design notes and manual e2e harnesses
├── package.json
└── vite.config.js
```

## Runtime Model

Development browser mode:

```text
React/Vite at :3000 -> /api proxy -> Go daemon at 127.0.0.1:8080
```

Electron mode:

```text
Electron main -> starts bin/crewai-daemon on 127.0.0.1:<port>
Electron main -> generates AUTH_TOKEN
preload -> exposes backend config to renderer
renderer -> HTTP/SSE with Authorization: Bearer <token>
```

If the preferred daemon port is occupied, Electron picks a free port and logs that choice to stdout.

## Install

```bash
npm install
```

Go dependencies are managed inside `daemon/`.

## Development

Run Electron development mode:

```bash
npm run dev
```

This builds `bin/crewai-daemon`, starts Vite, launches Electron, and lets Electron main start the daemon. The renderer waits because Electron does not create the window until `/health` is ready.

Run bare browser development:

```bash
npm run web:dev
```

Open:

```text
http://localhost:3000
```

The Vite dev server proxies `/api` to `http://localhost:8080` by default. Override with `CREWAI_BACKEND_URL` or `CREWAI_BASE_URL`.

## Build

Build the local Electron app:

```bash
npm run build
```

This builds:

- `bin/crewai-daemon`
- `dist/`
- `.electron-app/CrewAI Desktop.app`

## Daemon

The Go daemon remains HTTP/SSE-based.

Default:

```bash
cd daemon
go run ./cmd/crewai-daemon
```

Environment variables:

| Variable | Default | Description |
|---|---:|---|
| `HOST` or `CREWAI_DAEMON_HOST` | `127.0.0.1` | HTTP listen host. |
| `PORT` or `CREWAI_DAEMON_PORT` | `8080` | HTTP listen port. |
| `AUTH_TOKEN`, `CREWAI_AUTH_TOKEN`, or `CREWAI_API_TOKEN` | empty | Optional bearer token. Empty means development mode with no auth. |
| `CREWAI_STATE_DIR` | `~/.crewai` | Root directory for persisted state. |
| `CREWAI_RUNTIME_SCAN_DIR` | `$CREWAI_STATE_DIR/runtime-manifests` | Runtime manifest scan directory. |
| `CREWAI_CLAUDE_PATH` | `claude` | Optional Claude executable override. |
| `CREWAI_CODEX_PATH` | `codex` | Optional Codex executable override. |

When auth is enabled, all `/api/*` routes require:

```text
Authorization: Bearer <token>
```

`/health` is intentionally unauthenticated so Electron can wait for readiness before exposing the renderer.

## Common Commands

```bash
npm run dev      # go build + Electron dev
npm run build    # go build + renderer build + local Electron app
npm run web:dev  # go run daemon + bare Vite dev
npm run test     # daemon Go tests and renderer tests
npm run clean    # remove local build artifacts
```

## Backend Packages

| Package | Responsibility |
|---|---|
| `daemon/cmd/crewai-daemon` | HTTP daemon entrypoint. Reads env, creates `httpapi.Server`, listens on `HOST:PORT`. |
| `daemon/internal/httpapi` | REST handlers and chat SSE streaming endpoint. |
| `daemon/internal/app` | Business logic for runtimes, agents, skills, projects, chats, cancellation, and handoff loops. |
| `daemon/internal/store` | File-backed JSON/JSONL persistence under `CREWAI_STATE_DIR`. |
| `daemon/internal/runtime` | Runtime scan/execution interfaces plus local scanner and real/mock engines. |
| `daemon/internal/backendagent` | Adapters for local coding-agent CLIs. |
| `daemon/internal/broker` | In-process pub/sub for streaming chat events to SSE clients. |

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
GET  /api/agents
POST /api/agents
GET  /api/skills
POST /api/skills
GET  /api/projects
POST /api/projects
POST /api/chat/sessions
GET  /api/chat/sessions/{id}
POST /api/chat/sessions/{id}/messages
GET  /api/chat/sessions/{id}/events
POST /api/chat/sessions/{id}/cancel
```

Chat events support replay and SSE follow:

```text
GET /api/chat/sessions/{id}/events?after=0
GET /api/chat/sessions/{id}/events?after=0&follow=1
```

SSE event names:

- `chat.event`
- `done`
- `error`

## State

By default, the daemon stores state in:

```text
~/.crewai
```

Current storage layout:

```text
~/.crewai/
  runtimes.json
  agents/
  skills/
  projects/
  chats/
  runtime-manifests/
```

## Tests

```bash
npm run test
```
