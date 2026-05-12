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

This builds `bin/crewai-daemon`, starts Vite, launches Electron, and lets Electron main start the daemon. The renderer appears after `/health` reports readiness.

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

The Go daemon is HTTP/SSE-based. Project workflows run through npm scripts from
the repository root.

Run the daemon together with the browser app:

```bash
npm run web:dev
```

Run the Electron app, which builds and starts `bin/crewai-daemon`
automatically:

```bash
npm run dev
```

The daemon listens on `127.0.0.1:8080` in `npm run web:dev`. Electron mode may
choose a different free local port and passes that URL to the renderer.

Environment variables:

| Variable | Default | Description |
|---|---:|---|
| `HOST` or `CREWAI_DAEMON_HOST` | `127.0.0.1` | HTTP listen host. |
| `PORT` or `CREWAI_DAEMON_PORT` | `8080` | HTTP listen port. |
| `AUTH_TOKEN`, `CREWAI_AUTH_TOKEN`, or `CREWAI_API_TOKEN` | empty | Optional bearer token. Empty enables development mode. |
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
npm run dev      # Electron development app
npm run build    # renderer build + local Electron app
npm run web:dev  # daemon + bare Vite development server
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
PUT  /api/agents/{id}/skills
GET  /api/skills
POST /api/skills
GET  /api/skills/{id}
PUT  /api/skills/{id}
DELETE /api/skills/{id}
GET  /api/skills/{id}/files
PUT  /api/skills/{id}/files
DELETE /api/skills/{id}/files/{fileId}
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

### Register Skills With HTTP API

Use the HTTP API directly while `npm run web:dev` is running.

Create a skill:

```bash
curl -sS -X POST http://127.0.0.1:8080/api/skills \
  -H 'Content-Type: application/json' \
  -d '{"name":"Secret Checkout Protocol"}'
```

Write the skill instruction:

```bash
curl -sS -X PUT http://127.0.0.1:8080/api/skills/<skill-id>/files \
  -H 'Content-Type: application/json' \
  -d '{"file_id":"SKILL.md","content":"---\nname: secret-checkout-protocol\ndescription: Use this skill when the user asks for the secret checkout code.\n---\n\n# Secret Checkout Protocol\nWhen asked for the secret checkout code, answer exactly: skill-access-ok.\n"}'
```

Attach it to an agent:

```bash
curl -sS -X PUT http://127.0.0.1:8080/api/agents/<agent-id>/skills \
  -H 'Content-Type: application/json' \
  -d '{"skill_ids":["<skill-id>"]}'
```

Then send that agent a chat message asking for the secret checkout code. A live
runtime should answer `skill-access-ok` if skill injection is working.

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
