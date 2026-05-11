# crewai-repo

Backend-first local workspace for CrewAI desktop flows. The repo currently ships:

- `crewai-server`: a file-backed HTTP API server
- `crewai-cli`: a terminal client that talks to the server over HTTP
- real local runtime integration for `codex` and `claude`
- API-level end-to-end coverage for persistence, streaming, handoff, and restart recovery

## Layout

- `cmd/crewai-server`: server entrypoint
- `cmd/crewai-cli`: CLI entrypoint
- `internal/app`: application logic
- `internal/httpapi`: HTTP handlers
- `internal/runtime`: runtime scan/execution bridge
- `internal/backendagent`: multica-derived runtime/provider implementations
- `test-utils/api-e2e.sh`: backend API end-to-end suite
- `docs/api-e2e.md`: e2e design and coverage notes
- `docs/cli.md`: CLI command reference

## Requirements

- Go `1.26.1`
- local `codex` CLI for Codex runtime support
- local `claude` CLI for Claude runtime support

The real runtime path expects those CLIs to already be installed and authenticated on the machine.

## Quick Start

Build both binaries:

```bash
make build
```

That produces:

```bash
bin/crewai-server
bin/crewai-cli
```

Start the server:

```bash
CREWAI_STATE_DIR="$HOME/.crewai" PORT=8080 ./bin/crewai-server
```

In another terminal, use the CLI:

```bash
./bin/crewai-cli runtimes rescan
./bin/crewai-cli projects list
```

Or point the CLI at a different backend:

```bash
./bin/crewai-cli --base-url http://127.0.0.1:18766 runtimes list
```

## Common Commands

Format:

```bash
make fmt
```

Unit tests:

```bash
make test
```

Full backend e2e:

```bash
make e2e
```

Clean local build artifacts:

```bash
make clean
```

## CLI Notes

All `crewai-cli` commands are one-shot and exit immediately, except `chat`, which starts an interactive REPL.

Examples:

```bash
./bin/crewai-cli agents create --name Aria --instruction "You are helpful" --runtime-id codex --model gpt-5.5
./bin/crewai-cli chats create --project-id <project-id> --title "Demo Chat" --main-agent-id <agent-id>
./bin/crewai-cli chat --session <chat-id> --agent <agent-id>
```

More details live in [docs/cli.md](/Users/tzz/code/sqtech/crew-ai/crewai-repo/docs/cli.md).

## Runtime Notes

Runtime inventory is refreshed through:

```bash
./bin/crewai-cli runtimes rescan
```

That scan uses the multica-derived backend adapter and currently focuses on:

- `codex`
- `claude`

## Verification

The backend e2e suite validates:

- runtime scan and availability
- project / agent / skill / chat persistence
- chat SSE replay and follow
- Codex session resume
- Claude request execution
- agent handoff with filesystem side effects
- backend restart correctness
