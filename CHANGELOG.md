# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/getcrew44/crew44/-/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/getcrew44/crew44/-/compare/v0.1.0...v0.2.0
