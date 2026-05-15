# Crew44 — your AI coding agents, working as a team.

**A local-first desktop app for running a crew of AI coding agents on your own machine.**

Crew44 turns the coding agents you already have installed — Claude Code, Codex, and other CLI runtimes — into a coordinated crew. Instead of running one agent in one terminal, you assemble specialists (named personas), give them specialized skills and per-project memory, and let them hand work off to each other inside a single chat thread.

Everything runs on your machine. State is plain files under `~/.crew44/`. No cloud account, no remote inference, no telemetry — the only network traffic is whatever your underlying coding agent already makes.

## Why Crew44

- **Specialists, not generalists.** Stop over-prompting one agent. Compose a planner, a builder, and a reviewer who hand work off via a shared chat thread.
- **Skills that compound.** Capture a workflow once as a `SKILL.md` file. Every agent you attach it to gets it on every turn — across providers.
- **Per-project memory.** Each project gets its own `MEMORY.md` and history file. Agents pick up where they left off, even across restarts.
- **Local-first by default.** Daemon binds to `127.0.0.1`, state is plain files, no telemetry. The only network traffic comes from the agent CLIs themselves.
- **Auto-optimization.** A Partner agent quietly mines your run history on a schedule, proposes new memory, skills, and routing tweaks with evidence, and queues them for explicit Accept / Edit / Snooze / Dismiss. Nothing lands on disk without your click.
- **Phone in the loop.** A paired Expo mobile app connects over an encrypted Noise tunnel so you can read or nudge a running crew from your couch.

## Supported runtimes

Crew44 detects and routes to any of these on disk:

Claude Code · Codex

Have another CLI? The runtime layer is a small Go interface — add an adapter under `daemon/internal/backendagent/` and it appears in the picker.

## How it works

```
┌─────────────────┐    WebSocket JSON-RPC    ┌──────────────────┐    spawn    ┌─────────────────┐
│  Electron / UI  │ ◄──────────────────────► │   Go daemon      │ ──────────► │  agent CLIs     │
│  React 19       │                          │   127.0.0.1      │             │  (claude, codex,│
└─────────────────┘                          └──────────────────┘             │   …)            │
                                                      │                       └─────────────────┘
                                                      ▼
                                              ~/.crew44/  (plain-file state)
```

- **Daemon** — a single Go process at `daemon/`. Owns runtime discovery, agent/skill/chat state, and the JSON-RPC + event-stream surface. Auth is a per-launch bearer token; only `/health` is unauthenticated.
- **Renderer** — React 19 app in `src/`. Routes for Crew (agents, skills, runtimes), Tasks (chat threads with live streaming), New Task, Auto (suggestions), and Onboarding.
- **Mobile** — Expo app in `packages/mobile/` pairs over an encrypted Noise tunnel through a small relay so you can drive a crew from your phone.

## Core concepts

| Concept   | What it is                                                                                              |
|-----------|---------------------------------------------------------------------------------------------------------|
| Runtime   | A coding-agent CLI on disk (Claude, Codex, …) discovered by scanning.                                   |
| Agent     | A named persona bound to one runtime + model, with an instruction and attached skills.                  |
| Skill     | A file-based capability (`SKILL.md` + assets) injected into the runtime session when its agent runs.    |
| Project   | A working directory plus the chats that belong to it. Stored under `Documents/Crew44/` or a folder you pick. |
| Chat      | A turn-by-turn thread. One in-flight response at a time; events are an append-only `events.jsonl`.      |
| Handover  | A marker an agent emits to pass the turn to a teammate, with a one-line brief.                          |

## Getting started

### Prerequisites

- macOS or Linux (Windows support pending)
- Node 20+ and Go 1.22+
- At least one coding-agent CLI installed (`claude`, `codex`, etc.)

### Run the desktop app

```bash
npm install
npm run dev
```

This builds the Go daemon, starts Vite, launches Electron, and connects the renderer once the daemon reports healthy.

### Or run the browser dev mode

```bash
npm run web:dev
# open http://localhost:3000
```

Vite talks to the daemon at `ws://127.0.0.1:8080/rpc`.

### Pair the mobile app

```bash
npm run mobile:start -- --lan --port 8085 --clear
```

Scan the QR code from the desktop **Pair Mobile** dialog. See [`docs/mobile-pairing.md`](docs/mobile-pairing.md) for relay and pairing internals.

### Build a packaged desktop app

```bash
npm run build
# produces .electron-app/Crew44.app
```

## What's interesting under the hood

- **Append-only event log per chat.** `events.jsonl` is the single source of truth; WebSocket streaming is just replay + follow. Reconnect a renderer or pair a phone mid-turn — nothing is lost.
- **Structured system prompt.** Every turn assembles the same sections (Crew44 context, agent identity, instructions, optional handover task, conversation summary, available skills, handover targets, output protocol). Agents always know who they are and who they can hand off to.
- **Skill injection without lock-in.** Skills are standard directories on disk, copied into each runtime's working tree per turn. Move them between agents, providers, or projects — they keep working.
- **Memory with a size cap.** When `USER.md` or per-project `MEMORY.md` hits its cap, new entries park in a `.pending` sibling for compaction instead of silently dropping the write.
- **Optimizer trust boundary.** The auto-optimizer's scan working directory lives outside the `projects/` tree so a prompt-injected Partner scan can't land file operations next to real-project memory files.

## Privacy

- All UI, state, and orchestration happens on `127.0.0.1`. Crew44 itself does not call out to any remote service.
- The only outbound traffic is whatever the underlying coding-agent CLI you chose (`claude`, `codex`, …) makes on its own.
- Mobile pairing uses a relay for NAT traversal but the payload is end-to-end encrypted with Noise — the relay sees ciphertext only. Self-host the relay if you'd rather; the URL is configurable.
- No analytics, no error reporting, no phone-home.

## Project layout

```text
.
├── electron/              Electron main process, preload, app assets
├── src/                   React renderer
├── packages/mobile/       Expo mobile app
├── daemon/                Go module
│   ├── cmd/crew44-daemon  daemon entrypoint
│   ├── internal/          app, rpc, httpapi, store, runtime, agent adapters
│   └── test-utils/
├── docs/                  manual e2e harnesses + design notes
└── public/                renderer static assets
```

## Status

`v0.2.0` (2026-05-14). Electron desktop app, Go daemon, paired Expo mobile client, and auto-optimization are all shipping. The product surface is intentionally small — projects, agents, skills, runtimes, chats — and stays that way.

## Development

```bash
npm run dev      # Electron development app
npm run build    # renderer build + local Electron app
npm run web:dev  # daemon + bare Vite development server
npm run test     # Go tests + renderer tests + mobile tests
npm run clean    # remove local build artifacts
```

Daemon configuration via env vars:

| Variable                                      | Default                                | Description                                              |
|-----------------------------------------------|----------------------------------------|----------------------------------------------------------|
| `HOST` / `CREW44_DAEMON_HOST`                 | `127.0.0.1`                            | TCP listen host.                                         |
| `PORT` / `CREW44_DAEMON_PORT`                 | `8080`                                 | TCP listen port.                                         |
| `AUTH_TOKEN` / `CREW44_AUTH_TOKEN`            | empty                                  | WebSocket bearer subprotocol token. Empty = dev mode.    |
| `CREW44_STATE_DIR`                            | `~/.crew44`                            | Root directory for persisted state.                      |
| `CREW44_CLAUDE_PATH`                          | `claude`                               | Override the Claude CLI path.                            |
| `CREW44_CODEX_PATH`                           | `codex`                                | Override the Codex CLI path.                             |

When auth is enabled, `/rpc` requires WebSocket subprotocols:

```js
new WebSocket("ws://127.0.0.1:8080/rpc", [
  "crew44.rpc.v1",
  `crew44.bearer.${token}`,
])
```

See the JSON-RPC method list and skill-injection walkthrough in [`docs/`](docs/).

## License

[MIT](LICENSE) © 2026 getcrew44
