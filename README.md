<div align="center">

<img src="https://crew44.io/brand/mark44-rust-512.png" alt="Crew44" width="96" height="96" />

# Crew44

### A local-first orchestrator for running specialist AI agents on your own machine.

[![CI](https://github.com/getcrew44/crew44/actions/workflows/ci.yml/badge.svg)](https://github.com/getcrew44/crew44/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-c4644a.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20·%20Windows%20·%20Linux-1c1a17)
![Free](https://img.shields.io/badge/price-free-5b9c5f.svg)

[**Download**](https://crew44.io/download) · [Website](https://crew44.io) · [What's new](CHANGELOG.md)


</div>

---

Crew44 turns the AI agents you already run — Claude Code, Codex, Gemini, Cursor, and more — into a coordinated team. Instead of one generalist agent re-explaining context to itself all day, you assemble specialists, bind each to the model that wins at its job, and let them hand work off to each other inside one shared workspace.

Everything runs on your machine. State is plain files under `~/.crew44/`. No cloud account, no subscription, no telemetry — the only network traffic is whatever your underlying coding agent already makes.

https://github.com/user-attachments/assets/ce6e5293-6c58-4c37-8e00-74d654d2277c

## Download

Grab a signed desktop build for your platform — **free, no account required:**

| Platform | Format |
|----------|--------|
| **macOS** (Apple Silicon) | `.dmg` |
| **Windows** (x64) | `.exe` installer |
| **Linux** (ARM64) | `.AppImage` / `.deb` |

→ **[crew44.io/download](https://crew44.io/download)**

Prefer to build it yourself? See [Getting started](#getting-started).

## Why Crew44

| The old way — one agent | With Crew44 — a crew of specialists |
|-------------------------|----------------------|
| A new contractor every morning: never seen your repo, never learned your conventions. | **Per-project memory.** Monday's fix is in the crew's muscle memory by Thursday. |
| Skills never compound — whatever it figured out is gone by next task. | **Skills that compound.** Capture a workflow once as `SKILL.md`; every agent you attach it to gets it on every turn, across providers. |
| One generalist plans, builds, and reviews — no deep expertise in any role. | **Specialists in parallel.** Planner drafts while builder codes while reviewer checks. Handovers ship the baton, not the whole context. |
| Locked to a single model: pays Opus rates for a rename, runs a fast model on a hard call. | **The right model per role.** Opus plans, GPT-5.5 codes, a local model reviews — swap per task, not per app. |




## Supported runtimes

Crew44 detects and routes to any of these installed on your machine:

**Claude Code · Codex · Cursor Agent · Gemini CLI · Hermes · Kimi · OpenCode · OpenClaw · Pi · Qoder · Qwen Code**

The same skills folder runs across every provider, so you're never locked in. Have another CLI? The runtime layer is a small Go interface — add an adapter under `daemon/internal/backendagent/` and it shows up in the picker.

## Core concepts

| Concept   | What it is                                                                                              |
|-----------|---------------------------------------------------------------------------------------------------------|
| Runtime   | A coding-agent CLI on disk (Claude, Codex, Cursor, …) discovered by scanning.                           |
| Agent     | A named persona bound to one runtime + model, with an instruction and attached skills.                  |
| Skill     | A file-based capability (`SKILL.md` + assets) injected into the runtime session when its agent runs.    |
| Project   | A working directory plus the chats that belong to it. Stored under `Documents/Crew44/` or a folder you pick. |
| Chat      | A turn-by-turn thread. One in-flight response at a time; events are an append-only `events.jsonl`.      |
| Worktree  | An optional isolated git checkout for a chat. Toggle it on a new task and the crew works on its own `crew/…` branch without touching your working tree. |
| Handover  | A marker an agent emits to pass the turn to a teammate, with a one-line brief.                          |

The default crew ships with a **Partner**, an **Engineer**, a **Product Lead**, and a **Designer** — each owning a role, a model, and its own skills folder.

## How it works

```
┌─────────────────┐  WebSocket JSON-RPC   ┌──────────────────┐    spawn    ┌─────────────────┐
│  Electron / UI  │ ◄───────────────────► │   Go daemon      │ ──────────► │  agent CLIs     │
│  React 19       │                       │   127.0.0.1      │             │  (claude, codex,│
└─────────────────┘                       └──────────────────┘             │   cursor, …)    │
                                                   │                       └─────────────────┘
                                                   ▼
                                          ~/.crew44/  (plain-file state)
```

- **Daemon** — a single Go process at `daemon/`. Owns runtime discovery, agent/skill/chat state, and the JSON-RPC + event-stream surface. Auth is a per-launch bearer token; only `/health` is unauthenticated.
- **Renderer** — React 19 app in `src/`. Routes for Crew (agents, skills, runtimes), Tasks (chat threads with live streaming), New Task, Auto (suggestions), and Onboarding.
- **Mobile** — Expo app in `packages/mobile/` pairs over an end-to-end encrypted Noise tunnel through a small relay, so you can read or nudge a running crew from your phone.

## Privacy

- All UI, state, and orchestration happens on `127.0.0.1`. Crew44 itself does not call out to any remote service.
- The only outbound traffic is whatever the underlying coding-agent CLI you chose (`claude`, `codex`, …) makes on its own — including the on-demand headless browser, which fetches its Playwright package and Chromium via npm and visits the URLs the agent navigates to.
- Mobile pairing, when enabled, uses a relay for NAT traversal, but the payload is end-to-end encrypted with Noise, so the relay only sees ciphertext. You can self-host the relay if you prefer; the URL is configurable.
- No analytics, no error reporting, no phone-home.

## Getting started

### Prerequisites

- macOS, Windows, or Linux
- Node 20+ and Go 1.26+
- At least one coding-agent CLI installed (`claude`, `codex`, `cursor`, …)

### Run the desktop app

```bash
npm install
npm run dev
```

This builds the Go daemon, starts Vite, launches Electron, and connects the renderer once the daemon reports healthy.


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

## Development

```bash
npm run dev      # development app
npm run build    # renderer build + local app
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

When auth is enabled, `/rpc` requires WebSocket subprotocols:

```js
new WebSocket("ws://127.0.0.1:8080/rpc", [
  "crew44.rpc.v1",
  `crew44.bearer.${token}`,
])
```

See the JSON-RPC method list and skill-injection walkthrough in [`docs/`](docs/).

## License

[MIT](LICENSE) © 2026 Mindive Labs

<div align="center">
<sub>Built for developers who'd rather lead a crew than babysit a single agent.</sub>
</div>
