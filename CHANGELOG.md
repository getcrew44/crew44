# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-05-20

### Added
- **Pick a model when creating an agent.** The agent-creation dialog now shows a dropdown of supported models for the selected runtime instead of a freeform text input — Claude Code agents pick from `claude-opus-4-7` (default), `claude-sonnet-4-6`, and `claude-haiku-4-5-20251001`; Codex agents pick from `gpt-5.5` (default), `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex`.
- **Change an agent's model after the fact.** The agent detail page exposes the same dropdown as a property so you can swap models without recreating the agent. When no model is pinned, the dropdown surfaces the catalog default as the picked value and the avatar sub-text mirrors it.
- **Agent cards in the Crew list show the effective model.** Cards that previously hid the model badge for un-pinned agents now display the runtime's catalog default ID (`claude-opus-4-7`, `gpt-5.5`) using the same style as hand-picked models, so every card carries the same information.
- **`runtimes.models` RPC** returns the static catalog (id, label, provider, default flag) for a runtime so the UI can populate the dropdown.

### Changed
- **Default model is honored at execution time.** Backends now fall back through `agent.Model` → runtime metadata's `model` → catalog default (`DefaultModelID`) before invoking `claude --model …` / codex turn-context, so agents with no pinned model actually run on the spec's default instead of whatever the CLI's implicit default happens to be.
- **Switching an agent's runtime clears the pinned model.** Model IDs are provider-specific, so a stale value carried in the partial-update payload would otherwise be passed to the new backend and break. The runtime engine then falls back to the new runtime's catalog default at execution; callers that want to pin a model on the new runtime issue a second update.
- **Deferred handover divider preserves source-agent trailing output.** When the backend emits a handover marker mid-stream, the divider now buffers until the first event from a different agent — so any final messages from the source agent render before the divider rather than getting visually orphaned underneath it.

## [0.5.2] - 2026-05-20

### Changed
- **Auto-optimizer rules now gate on content quality, not session count.** Skill candidates need a complete reusable procedure (stable trigger + ordered steps) — one rich session is enough if the procedure is crystallized. Memory candidates need a durable fact or stated preference still true next week. Recurrence is supporting evidence, not a hard gate.
- **"Auto optimization" view drops the Strategy surface.** Strategy-shaped signals (routing, scheduling, agent shape, cost) are still mined, but they now map to a skill or a memory — there is no separate Strategy tab, schedule checkbox, kind badge, or accepted-state path. Hero and privacy copy updated to match.
- **Sidebar hides unfinished nav items.** The Search and Pair Mobile entries are commented out until those features ship; the JSX is preserved so re-enabling is a one-line revert.
- **Scan prompt teaches the LLM the new bar.** The partner `session-skill-mining` skill and the inline scan prompt name what to reject (framework boilerplate, patterns derivable in <60s from one file, bug post-mortems whose fix is merged, generic engineering advice, content already in CLAUDE.md/AGENTS.md/README) and give concrete false-positive and good-surfacing examples.

### Fixed
- **"Last scan" stays put while a new scan runs.** Clicking "Scan now" no longer flips the Auto optimization counter to "never" mid-scan. The daemon now resolves the displayed scan via `LatestFinishedScanID`, so an in-flight scan (FinishedAt still zero) doesn't shadow the previous result. Covered by `TestManager_ListSuggestions_LastScanAtPreservedDuringRescan`.

### Added
- **Agent cards show runtime, model badge, and instruction preview.** The Crew view's agent grid surfaces the model in a small badge and a two-line clamped instruction so you can scan an agent's identity without opening it.
- **Suggestion bodies and skill previews render inline markdown.** Auto optimization cards now parse `**bold**`, `` `code` ``, headings, and lists in suggestion bodies and skill `lines` previews; evidence run IDs are clickable to jump straight into the source chat.

## [0.5.1] - 2026-05-20

### Added
- **`using-superpowers` skill in the default coding agent preset** — the meta-skill from obra/superpowers ships with the default crew so the coding agent invokes its skills before every response.

### Fixed
- **Isolated `claude` can auto-refresh its OAuth token** — the spawned (isolated) claude now receives `CLAUDE_CODE_OAUTH_REFRESH_TOKEN` + `CLAUDE_CODE_OAUTH_SCOPES` alongside the access token, so an expired 12h token gets swapped for a fresh one in-process instead of 401'ing crew44 sessions until the user reopens the host Claude Code app. Refresh+scopes are treated as an atomic pair at both the parser and the injection site, and parent-env overrides are honored for the pair too.
- **Isolated `claude` can read `~/.crew44` again** — dropped the `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` injection that the previous fix added. Setting that var alongside the OAuth refresh credential flipped the spawned claude into its managed/enterprise-deployment posture, tightening the default permission policy and blocking the agent from filesystem paths that worked fine on `main`. The scrub only stripped ~7 credential vars from Bash/hook/MCP child envs, and `CLAUDE_CODE_*` vars are already filtered out of the parent env by backendagent before launch — not worth losing normal filesystem reach.

## [0.5.0] - 2026-05-18

### Added
- **Workspace files drawer** — split-panel drawer attached to the chat header's Files button, with two modes: a `git diff HEAD` view for projects with a workdir, and a full project file tree. Click any file to preview its content inline; click again to reveal in Finder. Drag the splitter to resize the conversation/drawer panes. Backed by new `projects.files.read` and `projects.git.diff` RPCs that sandbox to the project workdir.
- **Background done sound** — agent runs finishing in chats that aren't currently being viewed now play the chime so you know to come back. Gated on actual agent activity so canceled/empty runs stay silent.
- **Copy button on code blocks** — hover any fenced code block in an agent message to reveal a Copy button (with a brief Copied confirmation).
- **Double-click chat header to zoom** — double-clicking the chat header maximizes/restores the window via a new `window:zoom` electron IPC.

### Changed
- **Default Partner agent triages eagerly** — preset Partner prompt now routes to specialists by default instead of answering directly.
- **Default Coding agent leans on its skills** — preset Coding prompt now defers to its declared skills rather than restating them.
- **Streaming header reflects the agent that just spoke** — the streaming indicator prefers the last actually-rendered actor over a possibly stale `chat.current_agent_id`, so the header matches what the user just saw.
- **Files badge counts edited files only** — the Files count in the chat header now ignores read-only and `Bash` tool calls, matching what the drawer surfaces.
- **Mention/skill dropdowns scroll the active item into view** — pressing ArrowUp/Down past the visible window of the suggestion popover (new task composer and chat composer) now keeps the highlighted row on screen.
- **Bounded arrow-key navigation in mention dropdowns** — ArrowDown stops at the last item and ArrowUp stops at the first instead of wrapping.

### Fixed
- **Symlink TOCTOU in `projects.files.read`** — the file-read RPC now opens the symlink-resolved path so a swap between path validation and Open can't pivot outside the workspace sandbox.
- **Drawer refetch storm during streaming** — git diff and project file listings now coalesce bursts of tool events into a single refetch (600ms debounce), so an active stream no longer re-runs `git diff HEAD` and walks the workspace on every tool call.
- **New task composer textarea auto-resizes** — the input now grows with content (up to ~360px) starting from a single row instead of a fixed 5-row height, and the syntax-highlight overlay stays aligned as you scroll inside the textarea.

## [0.4.0] - 2026-05-15

### Added
- **Archive conversations from the sidebar** — hovering a chat reveals an archive button with inline confirmation; archived chats disappear immediately and are persisted via a new `chats.update` RPC path. Archived state survives reload, and an optimistic-archive cache keeps freshly archived chats from reappearing while subscriptions are still in flight.
- **Drop a folder onto the sidebar to add a project** — drag-and-drop multiple folders queues one folder-access confirmation per drop, matching the existing folder-pick flow.

### Changed
- **One agent header per run** — consecutive events from the same agent (message → tool calls → message) now share a single avatar+name+timestamp header instead of repeating it for every event. The header still renders on handovers, user messages, and the first event of each agent's turn.
- **Tool-call summary aggregates by name** — multiple calls to the same tool collapse to a single `Bash x3` entry in the "Used N tools" row rather than listing `Bash · Bash · Bash`. The count pop-animates on live increments and stays static on replay.
- **Tighter spacing between agent header and first sub-event** — top-heavy padding (`14px 0 2px` / `10px 0 2px`) so the gap between an agent message and its first tool matches the gap between subsequent tools (~4px instead of ~16px).
- **Auto-route icon refreshed** and new task auto-opens when a project is added.

### Fixed
- **Stuck "still working" spinner after daemon restart** — chats whose stream was persisted as `streaming` when the daemon last exited are now lazily flipped back to `idle` on first access (via `GetChat`, `ListChats`, `ListProjectChats`, `PostMessage`, and the `chats.events.subscribe` pre-replay), with a terminal `stream_interrupted` error event appended to the conversation so the UI shows why the run stopped. Detection signal: `stream.status=="streaming"` AND no entry in `a.cancels` under the same `a.mu`. Recovery is idempotent and serialized.
- **Tool-output reads no longer crash on >64KB lines** — `readJSONL` now bumps `bufio.Scanner`'s buffer to 64MB so chats with large tool results (one observed at 78KB) open instead of erroring on the scanner's default 64KiB cap. Previously this surfaced as the daemon failing to start any time a chat with a large tool output was loaded.
- **Audio chime actually plays when an agent finishes** — `playDoneSound` used to create a fresh `AudioContext` per call, which Chromium starts in `suspended` state without a recent user gesture. The fix uses a module-level shared context primed synchronously inside `handleSend` (the Send-button click is real activation) and resumes defensively on each play. Errors now log instead of being silently swallowed.
- **Done sound no longer fires for empty runs** — the chime now gates on actual agent activity since the last Send, so a `chat.done` with no new agent events (canceled run, reconnect-only) stays silent.
- **`archived_at` zero-time filtering** — `App.jsx` now treats Go's `0001-01-01T00:00:00Z` zero-time as "not archived" instead of as a truthy archived timestamp, so non-archived chats no longer disappear from the sidebar after a fresh `listProjectChats`.
- **Composer overlay scroll-position preserved** during textarea auto-resize — the height-recalc no longer resets `scrollTop` to 0, so the syntax-highlight overlay stays aligned with the cursor when content overflows the max height.
- **Streaming indicator shown for empty chats too** — dropped the `events.length > 0` gate so an actually-streaming chat shows the working state instead of a blank pane while replay catches up.
- **Claude Code login reused in isolated agent runs** — runtime path now reuses the Claude Code session instead of re-authenticating per agent.

## [0.3.0] - 2026-05-15

### Added
- **@file and @directory mentions in the composer** — typing `@` after whitespace now suggests files and folders from the project's working directory alongside agent names. Selecting a result inserts the relative path. Backed by a new `projects.files.list` RPC that walks the workdir, skips `.git`, `node_modules`, `dist`, `build`, `target`, `vendor`, and similar generated dirs, and caps results.
- **`/skill` slash command** — typing `/` after whitespace suggests skills enabled for the agent you're currently directing the message to, so you can append a skill without opening the agent picker.
- **Folder-access warning dialog** — adding a project from an existing folder (native picker, paste path, or drag-and-drop) now shows a confirmation dialog naming the folder and warning that the crew will be able to read, edit, and permanently delete its contents. Drag-and-drop of multiple folders queues one approval per folder so each can be approved or rejected individually.
- **Per-agent runtime label in pickers** — both the composer `@` list and the target-agent dropdown now show the agent's runtime (e.g. "Claude Code") beneath the name instead of a generic "Agent" subtitle.
- **Computer name in sidebar footer** — the app's footer label now shows the user's computer name (via `scutil --get ComputerName` on macOS, hostname fallback) instead of the first detected runtime's name.

### Changed
- **Sidebar chrome trimmed** — removed the non-functional sidebar toggle/back/forward buttons at the top of the rail and the placeholder Settings gear and Mobile phone buttons in the footer; only the restart-onboarding control remains.
- **`CustomPicker` selected highlight removed** — list items inside any popover that has a search box no longer paint a beige selected background; the checkmark continues to convey selection, and hover state still highlights.
- **`Plan ▾` button removed** from the composer toolbar — it was a placeholder with no behavior.

### Fixed
- **Elapsed timer keeps counting after runtime errors** — `TaskHeader` now freezes the elapsed counter at the timestamp of the most recent `error` event in the chat, so a stuck SSE stream after an agent failure no longer makes the conversation look like it's still running. Event payloads now preserve the original `tsISO` so the freeze point is exact.

## [0.2.0] - 2026-05-14

### Added
- **Auto-optimization** — weekly scheduled scans where a Partner agent mines your run history and proposes memory entries, new skills, and strategy suggestions. Each suggestion comes with evidence, a preview, and explicit Accept/Edit/Snooze/Dismiss controls so nothing is applied without your review.
- **AutoRoute UI** — new in-app view to triage suggestions, edit memory text or skill drafts before accepting, configure the scan cadence (off/daily/weekly/monthly), and inspect every chat the scanner looked at via the "What it sees" privacy modal.
- **Pending-compaction state** — when accepting a suggestion would push `USER.md` or per-project `MEMORY.md` over its size cap, the entry is queued under a `.pending` sibling file and the card marks itself for future compaction instead of silently dropping the write.
- **Conversation view event rendering** — TaskView now renders all seven backend event types (thinking, runtime session, error, handover, tool call/result, message), shows a "deleted agent" affordance for messages whose author was removed, and ticks elapsed time live for in-progress streaming.
- **Collapsible tool calls** — bulky tool call output collapses into a compact one-line row by default; click to expand for the full payload.
- **Handover detection across human turns** — agent-to-agent handovers are recognized even when a user message interleaves between the two agent messages.

### Changed
- TaskView extensively reworked to match the updated mocks (typography, spacing, divider chrome, picker affordances, header layout).
- Streaming UI keeps elapsed time honest after navigation: it picks up where it left off instead of resetting or stalling.
- System prompt path now injects a global `USER.md` and per-project `MEMORY.md` with an 8 KB safety cap and truncation marker.

### Fixed
- **Optimizer trust boundary** — moved the auto-optimizer's scan working directory out of the `projects/` tree to `optimizer/scan-workdir/` so a prompt-injected Partner scan can't land file operations next to real-project `MEMORY.md` files. Includes a migration from the legacy location.
- **Accept race** — concurrent Accept clicks no longer produce duplicate memory entries, duplicate skill files, or duplicate `applied/*.md` records; the check-apply-record window is now serialized.
- **Codex lifecycle hang** — when the codex stdout reader exits before the turn completes (oversized JSON line, process death), the lifecycle goroutine fails fast instead of waiting on the 10-minute semantic-inactivity timer.
- **Tool output UTF-8 boundary** — `boundCodexToolOutput` now backs off to a rune boundary before appending the truncation marker so CJK and emoji output don't get corrupted to U+FFFD after JSON re-encoding.
- **Codex stdout buffer** — bumped the per-line read limit so larger tool outputs no longer crash the scanner; truncation is bounded at 256 KiB with a clear marker.
- Pre-landing review safety hardening across the optimizer accept pipeline: stricter ID validation, atomic schedule writes, applied-markdown path-traversal guards, and memory-file size cap enforcement.

[0.4.0]: https://github.com/getcrew44/crew44/-/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/getcrew44/crew44/-/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/getcrew44/crew44/-/compare/v0.1.0...v0.2.0
