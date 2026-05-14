# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://gitlab.com/deepthinklabs/crewai/crewai-desktop/-/compare/v0.1.0...v0.2.0
