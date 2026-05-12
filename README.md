# CrewAI Desktop

Local-first CrewAI workspace for running multi-agent chat flows on your own machine.

This repository is structured as a standard Electron/Vite app at the top level, with the Go HTTP backend isolated in `daemon/`. Browser development uses Vite plus the daemon's HTTP API. Electron development and packaged apps launch the daemon automatically, choose a local port, generate an in-memory bearer token, and pass the backend config to the renderer through preload.

## Layout

```text
.
├── electron/              Electron main process, preload, app assets
├── src/                   React renderer source
├── public/                Renderer static assets
├── scripts/               Local Electron app build/run helpers
├── daemon/                Go module for daemon, CLI, API tests, internals
│   ├── cmd/crewai-daemon  HTTP daemon entrypoint
│   ├── cmd/crewai-cli     CLI entrypoint
│   ├── internal/          app, httpapi, store, runtime, agent adapters
│   └── test-utils/jsonq   helper used by e2e scripts
├── test-utils/            Shell e2e harnesses
├── Makefile
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

Run the daemon manually for pure browser development:

```bash
make daemon:dev
```

In another terminal, run Vite:

```bash
make dev
```

Open:

```text
http://localhost:3000
```

The Vite dev server proxies `/api` to `http://localhost:8080` by default. Override with `CREWAI_BACKEND_URL` or `CREWAI_BASE_URL`.

Run Electron development mode:

```bash
make electron:dev
```

This builds `bin/crewai-daemon`, starts Vite, launches Electron, and lets Electron main start the daemon. The renderer waits because Electron does not create the window until `/health` is ready.

## Build

Build the local Electron app:

```bash
make electron:build
```

This builds:

- `bin/crewai-daemon`
- `dist/`
- `.electron-app/CrewAI Desktop.app`

Run the built local app:

```bash
make electron
```

Build CLI plus Electron app:

```bash
make build
```

## Daemon

The Go daemon remains HTTP/SSE-based.

Default:

```bash
cd daemon
go run ./cmd/crewai-daemon
```

Equivalent make target:

```bash
make daemon:dev
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

## CLI

Build:

```bash
make build-cli
```

Run:

```bash
./bin/crewai-cli runtimes list
./bin/crewai-cli agents list
./bin/crewai-cli projects list
```

Override backend URL:

```bash
./bin/crewai-cli --base-url http://127.0.0.1:18766 runtimes list
```

## Common Commands

```bash
make fmt              # gofmt daemon packages
make test             # daemon Go tests and renderer tests
make build-daemon     # build bin/crewai-daemon
make build-cli        # build bin/crewai-cli
make daemon:dev       # run daemon from source
make dev              # run Vite only
make electron:dev     # build daemon, run Vite, launch Electron
make electron:build   # build daemon, renderer, local Electron app
make e2e              # run API e2e suite
make ui-e2e           # prepare and open UI e2e harness
make clean            # remove local build artifacts
```

## Backend Packages

| Package | Responsibility |
|---|---|
| `daemon/cmd/crewai-daemon` | HTTP daemon entrypoint. Reads env, creates `httpapi.Server`, listens on `HOST:PORT`. |
| `daemon/cmd/crewai-cli` | CLI entrypoint. Calls `internal/cli.Run`. |
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

API e2e:

```bash
make e2e
```

UI e2e harness:

```bash
make ui-e2e
```

The e2e suites use isolated state under `/tmp/crewai-api-e2e` and `/tmp/crewai-ui-e2e`.
