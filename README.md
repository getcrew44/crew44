# CrewAI Desktop

Local-first CrewAI workspace for running multi-agent chat flows on your own machine.

This repository is structured as a standard Electron/Vite app at the top level, with the Go daemon isolated in `daemon/`. Browser development uses Vite plus the daemon's WebSocket JSON-RPC endpoint. Electron development and packaged apps launch the daemon automatically, choose a local port, generate an in-memory bearer token, and pass the RPC config to the renderer through preload.

## Layout

```text
.
├── electron/              Electron main process, preload, app assets, scripts
├── src/                   React renderer source
├── packages/mobile/       Expo mobile app
├── public/                Renderer static assets
├── daemon/                Go module for daemon, API tests, internals
│   ├── cmd/crewai-daemon  daemon transport entrypoint
│   ├── internal/          app, rpc, httpapi, store, runtime, agent adapters
│   └── test-utils/jsonq   helper used by e2e scripts
├── docs/                  Design notes and manual e2e harnesses
├── package.json
└── vite.config.js
```

## Runtime Model

Development browser mode:

```text
React/Vite at :3000 -> ws://127.0.0.1:8080/rpc -> Go daemon
```

Electron mode:

```text
Electron main -> starts bin/crewai-daemon on 127.0.0.1:<port>
Electron main -> generates AUTH_TOKEN
preload -> exposes backend config to renderer
renderer -> WebSocket JSON-RPC with crewai.bearer.<token> subprotocol
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

The Vite dev server talks directly to `ws://127.0.0.1:8080/rpc` by default. Override with `CREWAI_RPC_URL`; `CREWAI_BACKEND_URL` or `CREWAI_BASE_URL` are still used for `/health`.

Run the Expo mobile app:

```bash
npm run mobile:start -- --lan --port 8085 --clear
```

See `packages/mobile/README.md` for the mobile development workflow and
`docs/mobile-pairing.md` for relay and pairing details.

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

The Go daemon exposes a small HTTP transport surface plus WebSocket JSON-RPC. Project workflows run through npm scripts from
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
choose a different free local port and passes `healthUrl`, `rpcUrl`, and `token`
to the renderer.

Environment variables:

| Variable | Default | Description |
|---|---:|---|
| `HOST` or `CREWAI_DAEMON_HOST` | `127.0.0.1` | TCP listen host. |
| `PORT` or `CREWAI_DAEMON_PORT` | `8080` | TCP listen port. |
| `AUTH_TOKEN`, `CREWAI_AUTH_TOKEN`, or `CREWAI_API_TOKEN` | empty | Optional WebSocket bearer subprotocol token. Empty enables development mode. |
| `CREWAI_STATE_DIR` | `~/.crewai` | Root directory for persisted state. |
| `CREWAI_RUNTIME_SCAN_DIR` | `$CREWAI_STATE_DIR/runtime-manifests` | Runtime manifest scan directory. |
| `daemon_debug`, `DAEMON_DEBUG`, or `CREWAI_DAEMON_DEBUG` | empty | When truthy, prints runtime scan diagnostics to daemon stderr. |
| `CREWAI_CLAUDE_PATH` | `claude` | Optional Claude executable override. |
| `CREWAI_CODEX_PATH` | `codex` | Optional Codex executable override. |

When auth is enabled, `/rpc` requires WebSocket subprotocols:

```js
new WebSocket("ws://127.0.0.1:8080/rpc", [
  "crewai.rpc.v1",
  `crewai.bearer.${token}`
])
```

`/health` is intentionally unauthenticated so Electron can wait for readiness before exposing the renderer.

## Common Commands

```bash
npm run dev      # Electron development app
npm run build    # renderer build + local Electron app
npm run web:dev  # daemon + bare Vite development server
npm run mobile:start -- --lan --clear  # Expo mobile app
npm run test     # daemon Go tests and renderer tests
npm run clean    # remove local build artifacts
```

## Backend Packages

| Package | Responsibility |
|---|---|
| `daemon/cmd/crewai-daemon` | Daemon entrypoint. Reads env, creates `httpapi.Server`, listens on `HOST:PORT`. |
| `daemon/internal/httpapi` | Thin HTTP transport for `GET /health` and `GET /rpc` WebSocket upgrade. |
| `daemon/internal/rpc` | JSON-RPC envelopes, method registry, WebSocket lifecycle, and chat event subscriptions. |
| `daemon/internal/app` | Business logic for runtimes, agents, skills, projects, chats, cancellation, and handoff loops. |
| `daemon/internal/store` | File-backed JSON/JSONL persistence under `CREWAI_STATE_DIR`. |
| `daemon/internal/runtime` | Runtime scan/execution interfaces plus local scanner and real/mock engines. |
| `daemon/internal/backendagent` | Adapters for local coding-agent CLIs. |
| `daemon/internal/broker` | In-process pub/sub for streaming chat events to RPC subscribers. |
| `packages/mobile` | Expo mobile client for pairing, project browsing, read-only agent viewing, and chat. |

## Daemon API

HTTP health endpoint:

```text
GET http://127.0.0.1:8080/health -> {"status":"ok"}
```

Business API endpoint:

```text
ws://127.0.0.1:8080/rpc
```

Requests use JSON-RPC 2.0:

```json
{"jsonrpc":"2.0","id":"req_1","method":"skills.list","params":{}}
```

Core methods:

```text
system.health
onboarding.get
onboarding.complete
runtimes.list
runtimes.rescan
runtimes.get
runtimes.update
agents.list
agents.create
agents.get
agents.update
agents.archive
agents.restore
agents.skills.replace
agents.preset.reset
presets.list
presets.defaultCrew.seed
presets.defaultCrew.reset
skills.list
skills.create
skills.get
skills.update
skills.delete
skills.files.list
skills.files.put
skills.files.delete
projects.list
projects.create
projects.get
projects.update
projects.delete
projects.chats.list
chats.create
chats.list
chats.get
chats.update
chats.delete
chats.messages.post
chats.events.list
chats.events.subscribe
chats.events.unsubscribe
chats.cancel
```

Chat event subscriptions replace SSE. Call `chats.events.subscribe` with
`{ "chat_id": "...", "after": 0 }`; the daemon returns a `subscription_id`,
replays historical events, then pushes `chat.event`, `chat.done`, and
`chat.error` notifications.

### Register Skills With JSON-RPC

Use the RPC endpoint while `npm run web:dev` is running.

Create a skill:

```json
{"jsonrpc":"2.0","id":"req_skill","method":"skills.create","params":{"name":"Secret Checkout Protocol"}}
```

Write the skill instruction:

```json
{"jsonrpc":"2.0","id":"req_file","method":"skills.files.put","params":{"id":"<skill-id>","file_id":"SKILL.md","content":"---\nname: secret-checkout-protocol\ndescription: Use this skill when the user asks for the secret checkout code.\n---\n\n# Secret Checkout Protocol\nWhen asked for the secret checkout code, answer exactly: skill-access-ok.\n"}}
```

Attach it to an agent:

```json
{"jsonrpc":"2.0","id":"req_attach","method":"agents.skills.replace","params":{"id":"<agent-id>","skill_ids":["<skill-id>"]}}
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
  app.json
  runtimes.json
  agents/
  skills/
  projects/
  chats/
  runtime-manifests/
```

`app.json` stores app-level state such as `last_onboarding_version`. A missing
or empty `last_onboarding_version` means onboarding is required; any non-empty
value means onboarding has already been completed.

In the desktop app, "New blank project" creates a real folder under the system
Documents directory reported by Electron, at `Documents/CrewAI/<project-name>`.
If the folder already exists, a numeric suffix is appended.

TODO: corrupted `app.json` is currently treated as already onboarded because
this path is rare and should not block app startup. Add an explicit repair/reset
surface if app-state corruption becomes user-visible.

## Tests

```bash
npm run test
```
