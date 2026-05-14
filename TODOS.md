# TODOS

## Auto-Optimization follow-ups
_Created by /plan-eng-review on 2026-05-13 for the feat0513/autooptimize branch._

### Real "Apply" semantics for Strategy suggestions
- **What:** Replace the v1 "Logged" path (write `applied/<id>.md`, no mutation) with real Apply semantics that actually edit schedules, reassign agents, or modify routing rules — per the original mock's promise.
- **Why:** Users will eventually expect the auto-optimizer to actually optimize. "Logged" is a v1 punt to avoid destructive UX in the first release.
- **Pros:** Closes the loop the mock implied; turns the feature from a journal into an actual optimizer.
- **Cons:** Destructive mutations need diff preview, undo journal, and per-kind UI (schedule-move vs agent-route vs agent-shape). Real cost: ~1-2 weeks human / ~2-3 hours CC.
- **Context:** v1 of auto-optimization writes `~/.crewai/optimizer/applied/<scan_id>-<suggestion_id>.md` as a paper-trail when a strategy suggestion is accepted. The card UI reads "Logged" instead of "Applied" to be honest with users. When this TODO is picked up, the AutoRoute label and toast copy revert to "Applied" only after the real apply paths exist.
- **Depends on / blocked by:** v1 "Logged" path shipping first; the schedule-move case probably also wants a diff preview component shared with future cron-editor UI.

### Eval suite for session-skill-mining JSON output
- **What:** A test harness that feeds synthesized session-history fixtures to a real Partner agent and asserts every output parses as `Suggestion[]`, respects the prompt's surface/threshold filters, and emits at least N suggestions per kind on seeded inputs.
- **Why:** The SKILL.md prompt is load-bearing for the entire optimizer — if the prompt drifts (or the model behind Partner changes), scans silently produce fewer/lower-quality suggestions and we have no signal.
- **Pros:** Protects against prompt regressions; gives confidence when editing SKILL.md or upgrading models; aligns with the "eval critical LLM call" rule from the test review.
- **Cons:** Costs money per run; requires synthesized history fixtures (~10 cases covering each kind × surface × threshold combo); not suitable for per-commit CI — runs on demand.
- **Context:** The optimizer's v1 unit tests cover the parser, scanner, and store with mocked LLM strings (T1A). They do not exercise the actual SKILL.md prompt against a real model. An eval suite closes that gap.
- **Depends on / blocked by:** v1 lands first so the JSON contract is stable; needs a way to point the test at a specific Partner-config-with-runtime (could reuse existing test helpers in `daemon/internal/app/`).

### Memory file compaction
- **What:** A compaction flow for `~/.crewai/USER.md` and per-project `MEMORY.md` when they approach their character caps (1,500 / 2,500). Today v1 stops accepting new memories once a file is full and shows a banner; user has to hand-edit.
- **Why:** Caps are bounded by design (hermes-agent inspiration: small, curated, injected once per session). Over months of use, accepted memories will accumulate until the cap is hit. Without compaction, the feature silently stops working past that point.
- **Pros:** Closes the loop; users never have to hand-edit a markdown file under `~/.crewai/`.
- **Cons:** Compaction is an LLM-driven merge step (similar to chat summarization) — needs its own prompt and possibly its own skill. Adds complexity.
- **Context:** v1 writes pending entries to `USER.md.pending` / `MEMORY.md.pending` when cap is exceeded; suggestion state is `pending_compaction`; banner surfaces in AutoRoute. The compaction flow would merge pending entries plus oldest accepted entries into shorter bullets, then move the result back into the live file.
- **Depends on / blocked by:** v1 memory injection shipping; needs prompt design for the compaction step.

### Integration test for scanner-to-chat wiring (T1B)
- **What:** One integration test in `scanner_integration_test.go` that boots a real `*app.App` with an in-memory store, seeds Partner with a `backendagent.MockBackend`, runs `RunScan` end-to-end, and asserts the suggestion store contains the expected records.
- **Why:** v1 ships with unit-only scanner tests (T1A) using an injected `ChatDispatcher` interface. That catches scanner logic bugs but not wiring bugs between scanner and real `App.PostMessage` (event polling, status transitions, runtime-missing path).
- **Pros:** Catches wiring regressions; uses existing mock backend pattern (`backendagent/claude_test.go`); one test, contained blast radius.
- **Cons:** Requires `MockBackend` to support tool-use mode for A2B providers — may need extension.
- **Context:** /plan-eng-review chose T1A for v1 (unit-only, fastest). T1B is the natural follow-up once the contract is stable.
- **Depends on / blocked by:** v1 unit tests landing; `MockBackend` tool-use support if A2B's provider-structured-output branch is exercised.

## P2 follow-ups from v0.2.0 ship review
_Deferred from pre-landing review on 2026-05-14. Cross-model surfaced these; cost-of-fix > blast-radius-now._

### Scanner retry re-parses the first failed JSON fence
- **Where:** `daemon/internal/optimizer/scanner.go:149`
- **What:** When the first Partner answer ships an invalid fenced JSON block, the production dispatcher returns all assistant messages, so the retry parse still extracts the same broken fence. Track the last assistant response or parse the LAST JSON fence on retry instead of the first.
- **Why this is P2:** Affects recovery only; the happy path works. Worst case: retry doesn't help and the scan logs as failed with `.failed.txt` for inspection.

### Duplicate miner-IDs collide into a single suggestion record
- **Where:** `daemon/internal/optimizer/scanner.go:213`
- **What:** If the model emits two suggestions with the same `id`, or the `s-N` fallback collides with a real `s-1`, both entries get the same server-side ID. Result: duplicate React keys + folded state record + Accept on one affects the other. Fix: per-scan used-ID set with suffix-on-collision.
- **Why this is P2:** Requires model misbehavior or a specific fallback collision. UI degrades but doesn't corrupt the store.

### Project-memory `scope_id` not validated against existing projects
- **Where:** `daemon/internal/app/optimizer.go:177`
- **What:** When `KindMemoryProject` ships a safe-but-non-existent `scope_id`, `AppendProjectMemory` creates `~/.crewai/projects/proj-<scope>/MEMORY.md` for a project that doesn't exist. The entry is "accepted" but no real chat will ever inject it. Check that the project exists before appending.
- **Why this is P2:** Silent UX failure, not a security problem. The file is written and visible; user can spot it on next scan or memory inspection.

### Accept re-applies side effects when state is `dismissed`/`snoozed`
- **Where:** `daemon/internal/optimizer/manager.go:119`
- **What:** The acceptance short-circuit only triggers on `accepted` / `pending_compaction`. Accepting an already-dismissed or snoozed suggestion still runs `applyAccept`, writing memory/skill/applied a second time. Today the UI guards this, but a buggy or malicious RPC client could re-trigger writes.
- **Why this is P2:** Currently a defense-in-depth concern; AutoRoute prevents the path. Becomes more important if optimizer gains additional RPC surfaces.

### `pending_compaction` is a UI dead-end until compaction ships
- **Where:** `src/AutoRoute.jsx:29` (closed state) + `src/AutoRoute.jsx:204` (Undo only for dismissed/snoozed)
- **What:** Memory entries that overflow the cap are queued under `.pending` and marked `pending_compaction`. The compaction flow isn't built yet (already tracked above), but in the meantime the card has no Reset/Retry/Undo affordance — the user cannot dismiss the pending state from the UI.
- **Why this is P2:** Will resolve naturally once the compaction TODO above ships. Until then, edit `~/.crewai/USER.md.pending` by hand if needed.

### `doneStatus` treats a never-started chat as success
- **Where:** `daemon/internal/app/optimizer.go:90-102`
- **What:** `WaitDone` calls `doneStatus`, which returns "done, success" when `chat.Stream.Status != "streaming"`. A freshly-created chat that never had `PostMessage` called is `"idle"` — `WaitDone` returns nil immediately. Today the optimizer always calls `CreateChat → PostMessage → WaitDone` in sequence so the bug is unreachable. Add a defensive check (at least one assistant event seen, or `Stream.AgentID` set) so the helper stays safe for future callers.
- **Why this is P2:** Unreachable today; harden the helper before someone else relies on it.

## Cross-runtime session resume bug
_Recorded 2026-05-14 from a live failure: Partner agent's runtime was switched from codex → claude mid-chat, next user message surfaced `runtime_error: runtime execution failed`._

### `LastRuntimeSession` is not scoped by runtime
- **Where:** `daemon/internal/model/types.go:90-94` (`LastRuntimeSession`), `daemon/internal/app/chat.go:138-141` (resume gate), `daemon/internal/backendagent/claude.go:444-446` (where `--resume` is built)
- **What:** `chat.LastRuntimeSession` holds only `AgentID` + `SessionID`. The resume gate matches on `AgentID` alone, so changing an agent's `RuntimeID` still replays the saved id into the new runtime. A codex thread id passed to `claude --resume` makes claude exit in ~800ms with "No conversation found with session ID…"; the daemon logs `claude resume did not land; clearing fresh session id for daemon fallback` and the turn surfaces as `runtime_error`.
- **Proposed fix:** Replace single slot with `LastRuntimeSessions map[string]LastRuntimeSession` keyed by `agent_id + ":" + runtime_id`, and add `RuntimeID` + `Provider` fields. The stream side already emits these via `RuntimeSessionPayload` (`types.go:174-179`); only the store/chat gate needs to consume them. Map (vs. adding `RuntimeID` to the single slot) preserves continuity when users toggle runtimes back and forth.
- **Why deferred:** Schema change touches chat persistence and every runtime's session-write path. Workaround for now: start a new chat after switching runtimes.

### Engine-error path doesn't clear the bad SessionID
- **Where:** `daemon/internal/app/chat.go:212-218`
- **What:** On `engine.Run` error the handler returns before line 225, so `chat.LastRuntimeSession` is never updated. Even with the scoping fix above, any other resume failure (corrupted session file, cwd drift, claude pruning old sessions) keeps the chat stuck retrying the same dead id. Fix: on error, either persist a `RuntimeSessionPayload` that came through the stream callback (fresh id from the failed run) or delete the slot for `(agent, runtime)`.
- **Why deferred:** Currently masked because the scoping bug above is the only known trigger; once that's fixed, this becomes the rare-but-real failure mode worth hardening.

### Eager invalidation on agent runtime change
- **Where:** Wherever agents get edited (RPC path that updates `agent.RuntimeID`).
- **What:** When a user changes an agent's runtime, walk chats where that agent participates and drop now-stale slots. Not required for correctness once scoping is in place, but prevents `LastRuntimeSessions` from accumulating dead entries and gives a natural seam to surface a UI hint like *"Runtime changed — conversation will restart on next message."*
- **Why deferred:** Pure hygiene; depends on the scoping fix landing first.

## Completed
- v0.2.0 (2026-05-14): Auto-optimization v1 (Partner-driven scans), AutoRoute UI, conversation event rendering, optimizer trust-boundary fix, Accept-race fix with race regression test, Codex lifecycle fast-fail on reader exit, UTF-8-safe tool output truncation.
