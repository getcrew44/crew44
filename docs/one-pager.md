# CrewAI Desktop

**A local-first workspace for orchestrating teams of AI coding agents on your own machine.**

## What it is

CrewAI Desktop turns the coding agents you already have installed — Claude Code, Codex, and other CLI runtimes — into a coordinated crew. Instead of running one agent in one terminal, you assemble specialized agents (a planner, a backend engineer, a reviewer), give them shared skills and per-project memory, and let them hand work off to each other inside a single chat thread.

Everything lives on your machine. State is plain files under `~/.crewai/`. No cloud account, no remote inference, no telemetry — the only network traffic is whatever your underlying coding agent already makes.

## Who it's for

Developers who already lean on CLI coding agents and want:

- A persistent home for multiple agents instead of one-shot terminal sessions.
- A way to compose specialists rather than over-prompting a single generalist.
- A real GUI for browsing chats, editing skills, and reviewing what an agent did — without giving up local execution.

## How it works

```
Electron shell ──► Go daemon (127.0.0.1) ──► local agent CLIs (claude, codex, …)
      ▲                  │                              │
      └── React UI ◄── WebSocket JSON-RPC ◄── streamed chat events
```

- **Daemon** — single Go process at `daemon/`. Owns runtime discovery, agent/skill/chat state, and the JSON-RPC + event-stream surface. Auth is a per-launch bearer token; `/health` is the only unauthenticated endpoint.
- **Renderer** — React 19 app in `src/`. Routes for Crew (agents, skills, runtimes), Tasks (chat threads with live streaming), New Task, Auto (suggestions), and Onboarding.
- **Mobile** — Expo app in `packages/mobile/` pairs over an encrypted Noise tunnel via a small relay (`wss://relay.mindivelabs.com/relay` by default) so you can read or nudge crews from your phone.

## Core concepts

| Concept   | What it is |
|-----------|-----------|
| Runtime   | A coding-agent CLI on disk (Claude, Codex, …) discovered by scanning. |
| Agent     | A named persona bound to one runtime + model, with an instruction and attached skills. |
| Skill     | A file-based capability (`SKILL.md` + assets) that gets injected into a runtime session when the owning agent runs. |
| Project   | A working directory plus the chats that belong to it. Created blank under `Documents/CrewAI/` or pointed at an existing folder. |
| Chat      | A turn-by-turn thread. One in-flight response at a time; events are an append-only `events.jsonl` that the UI replays + follows. |
| Handover  | A `<CREWAI_AGENT_HANDOVER agent_id="…">…</CREWAI_AGENT_HANDOVER>` marker an agent emits to pass the turn to a teammate, with a one-line brief. |

## What's interesting under the hood

- **Append-only event log per chat.** `events.jsonl` is the single source of truth; the WebSocket stream is just replay + follow, so reconnecting a renderer or pairing a phone never loses state.
- **Structured system prompt template.** Every turn assembles the same sections (CrewAI context, agent identity, instructions, optional handover task, conversation summary path, available skills, handover targets, output protocol) — agents always know who they are and who they can hand off to.
- **Skill injection without lock-in.** Skills are stored as standard directories on disk and copied into the runtime's working tree per turn, so the same skill works across providers.
- **Auto-optimization (v0.2.0).** A Partner agent scans run history on a schedule, proposes new memory entries, skills, and strategy tweaks with evidence, and queues them for explicit Accept / Edit / Snooze / Dismiss — nothing lands on disk without your click. Accepted memories become their own typed markdown files under `memory/`, linked from a one-line-per-entry `MEMORY.md` index. When the index hits its size cap, the new pointer parks in `MEMORY.md.pending` for compaction while the body file is written normally.

## Getting started

```bash
npm install
npm run dev          # Electron app — builds daemon, launches UI
# or
npm run web:dev      # daemon + bare browser dev at localhost:3000
```

State lives in `~/.crewai/` (`agents/`, `skills/`, `projects/`, `chats/`, `runtime-manifests/`). Delete the directory to reset.

## Status

`v0.2.0` (2026-05-14). Electron desktop app, Go daemon, paired Expo mobile client, and auto-optimization are all shipping. The product surface is intentionally small — projects, agents, skills, runtimes, chats — and stays that way.
