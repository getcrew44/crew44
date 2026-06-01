# Changelog

All notable changes to this project are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-06-01

### Added
- **Recruit — browse and install community agents.** A new Recruit section lets you discover agent packages published as tagged GitHub releases and install them with one click. Each entry shows its description, declared skills, recommended runtime, and the upstream repo it wraps. The detail view renders the agent's INSTRUCTIONS.md as rich text, autolinks URLs, and links straight to the source repository.
- **`recruit-import` CLI** for packaging an upstream repository into an installable agent: it resolves a release tag, fetches the tarball, and produces a manifest you can publish.
- **`CREW44_AGENT_SOURCE_DIR`** is exposed to spawned runtimes, so an installed agent can read its own INSTRUCTIONS.md, declared skills, and bundled reference files locally at run time.

### Changed
- **Agent installs now use an archive payload with atomic commit.** Installation downloads the tagged GitHub tarball, filters files through gitignore-style include/exclude globs declared in the manifest, and rotates the new payload into place atomically — a failed or oversize install never leaves partial state behind. Downloads, extracted payloads, per-file size, and file counts are all bounded.
- **Manifest schema** gained `source_type`, `upstream`, and `payload` fields, with validation that rejects unsafe skill paths, traversal globs, and schema versions outside the v1 family. The schema moved into a public package so the importer and the daemon installer enforce identical rules.
- The agent entrypoint file was renamed from `AGENT.md` to `INSTRUCTIONS.md`.

### Fixed
- Release tags whose manifest version disagrees with the tagged commit are rejected, so a mislabeled release can't be installed.
- Metadata and schema errors surface as bad-request at the RPC layer instead of opaque failures, and malformed registry rows are dropped rather than served.
- A failed fresh install cleans up its agent directory instead of leaving an empty or partial one.
- GitHub `git-archive` tarballs that lead with a `pax_global_header` record are handled correctly instead of being mistaken for a second top-level directory.
- Agent `config.json` is now written atomically (temp file + rename), and the agent listing skips an incomplete agent directory instead of failing entirely — so an install interrupted by a crash can no longer hide every other agent from the UI.
- Payload extraction bounds total decompressed output across all archive entries, so a small compressed tarball padded with skipped binary files can no longer force unbounded decompression work.

## [0.6.2] - 2026-06-01

### Changed
- Mobile PWA no longer shows install instructions after pairing; the app entry now omits the install prompt controller entirely.

## [0.6.1] - 2026-06-01

### Changed
- Mobile PWA chat polish: tool rows now open from the full row, expanded tool calls show arguments in the header, multiline tool output keeps `pre` formatting, chat back returns to the project chat list, and the home menu no longer dims the page or shows blue text for `Agents`.

### Fixed
- Desktop chat switching no longer races composer draft hydration, so fresh input is not overwritten while changing chats and the stale-draft test stops flaking.

## [0.6.0] - 2026-05-27

### Added
- Run a task in an isolated git worktree. Toggle "Git worktree" in the New Task composer and the crew works on its own branch (`crew/<id>`, renamed to a slug of your task title) without touching your working tree. Pick the base branch the worktree forks from.
- Worktree badges across the UI: the task header shows the branch and its base ref, and the sidebar marks worktree-backed chats with a branch glyph.
- File views, the diff drawer, working-tree file counts, and `@`-file mentions are now scoped to a chat's worktree when it has one, so each task shows its own changes instead of the shared project directory.
- Confirmation dialog before deleting a project, warning that the project's chats and any associated worktrees may be removed from disk.

### Fixed
- Worktrees are detached from your source repo when their chat is deleted and when the owning project is deleted (including archived chats), so no stale `git worktree` admin refs or branches linger.
- Retrying a task after the first message fails to send no longer wedges on an already-provisioned worktree branch — it reuses the chat instead of trying to recreate it.
- The worktree toggle keeps your choice when you switch between projects and survives chat refreshes.

### Removed
- Untracked internal planning docs (`docs/`) from the repository.

## [0.5.8] - 2026-05-25

### Added
- **The main interactive agent now has a headless browser.** Crew44 gives each runtime a Playwright MCP server, so an agent gains `browser_navigate`, `browser_take_screenshot`, `browser_snapshot`, and the rest of the `mcp__playwright__*` toolset the moment it asks. claude receives it through its `--mcp-config` document (claude runs with `--strict-mcp-config`, which ignores `.claude.json`); codex receives it through an `[mcp_servers.playwright]` table in its isolated `config.toml`. The browser runs headless and isolated, launched on demand via `npx` — no extra binary ships with Crew44. Agents reuse one shared Chromium download via the host `ms-playwright` cache, overridable with `PLAYWRIGHT_BROWSERS_PATH`. Browser access is opt-in per run, so background utility calls (like the chat-title summarizer, which runs on untrusted user content under bypass-permissions) get no browser surface.

### Changed
- **The "waiting" word in the task view rotates every 15 seconds instead of every 8.** The streaming indicator's gerund changes less often, so it reads as a calmer status line rather than a flickering ticker during long runs.
- **The Playwright browser package is pinned to a tested version (`@playwright/mcp@0.0.75`) rather than `@latest`.** Agent browser behavior stays reproducible across runs, and a new npm publish can't change tool behavior underneath every runtime. Bump deliberately after testing.
- **`package.json` author now carries a contact email** (`support@mindivelabs.com`) alongside the name.

## [0.5.7] - 2026-05-22

### Added
- **42-skill product management library.** The default Product Lead now ships with a full product-management skill library covering discovery (jobs-to-be-done, discovery-process, customer-journey-map, pol-probe), strategy (positioning-statement, tam-sam-som-calculator, pestel-analysis, opportunity-solution-tree), planning (prd-development, lean-ux-canvas, recommendation-canvas, prioritization-advisor, feature-investment-advisor, roadmap-planning), delivery (user-story / -splitting / -mapping / workshop, storyboard, press-release, workshop-facilitation), and growth and metrics (acquisition-channel-advisor, organic-growth-advisor, saas-revenue-growth-metrics, saas-economics-efficiency-metrics, finance-based-pricing-advisor, finance-metrics-quickref, business-health-diagnostic). Each skill ships as a SKILL.md with templates and examples where useful.
- **Rewritten Product Lead and Designer prompts.** Both default agents are rebuilt as coaching specialists. The Product Lead picks the narrowest matching skill from the library, calibrates evidence (observed / inferred / assumed / unknown), and produces decision-ready PM artifacts. The Designer treats HTML as the preferred medium for artifacts (canvases, hi-fi prototypes, decks, specs, critiques) and grounds every design in real context — brand, existing UI, tokens, copy voice — instead of training-data defaults.
- **Real-time auto-title push.** A new `chat.updated` broker event and SSE notification streams the auto-summarizer's title to the frontend the moment it lands, so the sidebar entry refreshes without waiting for the next mount. The chat stream subscription stays open after the main run's done event to receive post-stream metadata pushes.

### Changed
- **Title summarizer no longer races the chat run on the shared skills directory.** The auto-title call moves its prompt prefix inline (instead of using `Agent.Instruction`, which Claude Code's `--append-system-prompt` couldn't override against the default "be helpful" rule), and the runtime skill-injection step now treats empty `AgentSkills` plus empty `RuntimeEnvDir` as an opt-out — so the title call no longer touches the main turn's `claude-config/skills` tree. Non-isolated Claude invocations get the host's `CLAUDE_CODE_OAUTH_*` env re-injected so the spawned child can still authenticate.

### Fixed
- **Stop button freezes the elapsed-time counter immediately.** Clicking Stop now patches `chat.stream.status` to `idle` in local state and stamps `updated_at`, so the per-second tick locks in at the moment of click instead of running forever against `Date.now()` while waiting for the daemon's async `chat.done`.
- **Sidebar Archive entry removed.** The Archive item on the project context menu was wired to `onClose` with no action behind it. Dropped until the archive flow exists; Remove still covers the destructive path.

## [0.5.6] - 2026-05-21

### Added
- **Agent descriptions.** Each agent now has a `Description` field separate from its `Instruction`, used by peer agents to decide whether to hand off. The default-crew presets (partner / coding / product / designer) ship explicit descriptions; legacy agents without one get a derived value distilled from the first paragraph of their instruction (rune-capped at 240 chars) and a lazy backfill the next time they are saved. The create-agent dialog gains an optional Description textarea and the agent detail view gains a Description tab with a Revert button that previews the derived fallback for legacy agents.
- **Shared handover routing rules.** The handover list in every agent's system prompt now shows each peer's effective description and a uniform `Routing:` block — compare the request against listed agents' descriptions, route the moment the scope matches, and save intermediate work before handing off. Coding / Product / Designer each gain a "designed scope" paragraph so specialists hold their own work instead of bouncing requests back to the partner.
- **Auto-summarized chat titles.** When the user sends the first message in a new chat, the daemon dispatches a one-shot LLM call (in parallel with the first turn, with a 30s timeout) that writes back a tight 3-6 word title via the chat's own runtime. Manual renames lock the title via a new `TitleSetByUser` flag, so a user-set title always wins over auto-summarization.
- **Right-click context menu on sidebar chats.** Right-clicking any chat row opens a menu with Rename (swaps the row to an inline input — Enter saves, Esc cancels, blur saves) and Archive (fires immediately). The optimistic rename keeps the sidebar entry's title up to date before the daemon round-trips, and errors roll back via the toast pipeline. The existing hover-X-then-confirm archive flow stays for users who learned it.
- **`@file` and `/skill` pickers in the new task composer.** The new task composer previously only suggested agent mentions; `@` now offers agents and files (gated on the selected project having a workdir) and `/` offers the selected lead's allowed skills, mirroring the TaskView composer. Suggestion-bounds parsing moves into `composerMentions.jsx` so both composers share one implementation.
- **Platform-aware conversation find.** Conversation-file lookups now honor the runtime's platform conventions instead of assuming POSIX paths, so Cursor / Hermes / OpenClaw sessions resolve correctly on Windows.

### Changed
- **Handover scratch files moved to chat session storage.** Agents handing off now write intermediate work (plans, drafts, partial diffs, notes) to `~/.crew44/chats/chat-<id>/handover/<short-slug>.md` instead of `tmp/handover/` under the project workdir. Files now sit next to `events.jsonl` and `summary.md`, are reachable by the receiving agent via an absolute path in the handover note, and get cleaned up when the chat is deleted.
- **Handover note format is now required.** The system prompt spells out the four sections every handover file must contain — `User report`, `Context`, `Goal`, `Suggested approach` — plus a `Handover at:` RFC3339 timestamp. A bare pointer at a file with no sections is no longer treated as a real handover, so the receiving agent can always pick up cold.

## [0.5.5] - 2026-05-21

### Added
- **Qoder runtime support.** Crew44 detects and runs `qodercli --acp`, speaking the standard Agent Client Protocol (ACP) over stdio. Skills under `.qoder/skills` are auto-injected. Set `CREW44_QODER_PATH` to override the binary location and `CREW44_QODER_MODEL` to hint a default model.
- **Qwen Code runtime support.** Crew44 detects and runs Alibaba's `qwen` CLI (a Gemini-CLI fork that ships the identical `-p / --yolo / -o stream-json / -m / -r` invocation). Ships a static Qwen3-Coder model catalog (`qwen3-coder-plus` default, plus `qwen3-coder-next` preview, `qwen3-coder-480b-a35b-instruct`, `qwen3-coder-30b-a3b-instruct`, and `qwen3.5-plus`). Set `CREW44_QWEN_PATH` / `CREW44_QWEN_MODEL` to override.
- **Scanner now detects the full supported CLI set.** Previously only Claude Code and Codex appeared in the runtime list. The scanner now surfaces Cursor Agent, Gemini CLI, Hermes, Kimi, OpenCode, OpenClaw, and Pi as first-class entries — each with a `CREW44_<NAME>_PATH` / `CREW44_<NAME>_MODEL` override and a display name in the UI.
- **Product icons in the onboarding runtime list.** Each runtime row shows the actual product mark (Claude Code, Codex, Cursor Agent, Gemini CLI, Hermes, Kimi, OpenCode, OpenClaw, Pi, Qoder, Qwen) instead of the first letter of the provider ID — fixes the collision that put a "C" next to Claude, Codex, and Cursor and a "Q" next to both Qoder and Qwen. Icons are sourced from [Lobe Icons](https://github.com/lobehub/lobe-icons) (MIT) and live under `src/runtime-icons/<provider>.svg`; missing entries fall back to the original letter avatar. A uniform 1px frame keeps icons visually the same size regardless of how thin or chunky the underlying brand mark is.
- **"Show N more runtimes not installed" toggle in onboarding.** With the scanner now detecting up to eleven providers, the onboarding card was about to fill with greyed-out "not installed" rows for users who only have Claude or Codex installed. The view now shows available runtimes first and tucks the rest behind a collapsible row that names the count, so the common one-or-two-installed case stays tidy.

### Changed
- **Pi sessions now live at `~/.crew44/pi-sessions`.** Aligned with the rest of the project's state directory under `~/.crew44/`. Internal identifiers used by the daemon (ACP client names, model-discovery temp directories, MCP config temp file prefix, OpenClaw session ID prefix) also use the `crew44` namespace.
- **Dropped Kiro backend.** The `kiro` runtime is no longer registered or detected. The slot in the model-discovery dispatch is now used by Qoder.
- **Pluralised the onboarding runtime-ready title.** Two or more available runtimes now read "Your runtimes are ready." instead of the previous singular "Your runtime is ready."
- **Renamed the onboarding "not found" status pill to "not installed"** to match the surrounding copy and clarify that the runtime is missing from PATH, not broken.
- **Composer sheds its outer chrome.** The "Steer this run…" / "Steer the crew" composer used to sit on a `#FCFAF1` strip separated from the conversation timeline by a hairline `#ECE6D5` divider. The strip and divider are gone — the composer now floats on the same `#FAF5E8` background as the timeline, with a short bottom-anchored fade so timeline content visually dissolves into the input area instead of slamming into a horizontal rule. The inner rounded input box keeps its own border and radius so the textarea is still a clear affordance.
- **Crew → Runtimes shows product icons + a "supported runtimes" tail.** The runtime list in the Crew tab now renders the same product marks as the onboarding scan (Claude Code, Codex, Cursor Agent, Gemini CLI, Hermes, Kimi, OpenCode, OpenClaw, Pi, Qoder, Qwen) and surfaces a collapsible "Other supported runtimes" group listing the ones the scanner didn't find, so users can see at a glance which CLIs Crew44 knows how to drive. Auto-expands when zero or one runtime is installed.
- **Runtime icon URL lookup extracted to `src/runtime-icons/index.js`** so both `OnboardingRoute` and `CrewRoute` import the same `runtimeIconUrl()` helper instead of duplicating the Vite glob/map.

### Fixed
- **Windows: freshly-installed CLIs become visible without restarting Crew44.** The daemon used to inherit a stale PATH from Electron (which inherits from `explorer.exe` and never sees `WM_SETTINGCHANGE`), so installing `claude.exe` or `codex.cmd` while Crew44 was running did nothing — clicking "Rescan" could not find them. `LocalScanner.Scan()` now re-reads `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path` and `HKCU\Environment\Path` from the registry on every scan and merges them into the daemon's PATH (with case-insensitive dedup and `REG_EXPAND_SZ` expansion) so subsequent `exec.LookPath` calls see post-install changes.
- **Gemini version detection no longer breaks on Windows.** The gemini npm shim prefixes `Active code page: 65001` from a fresh `cmd.exe`; the semver regex now skips that line instead of failing the version check. Removed a dead `CheckMinCLIVersion` path that referenced a CLI Crew44 does not ship.

## [0.5.4] - 2026-05-20

### Added
- **Signed, notarized macOS DMG distribution script.** `npm run dist` now bundles the daemon, builds the Vite UI, packages the Electron app, and (when Apple credentials are present) signs and notarizes the result into a distributable `.dmg`. `npm run dist:unsigned` skips signing/notarization for local builds. New entitlements file at `electron/build/entitlements.mac.plist`.

### Fixed
- **Claude settings.json with numeric or boolean env values no longer crashes the daemon.** The parser previously rejected configs like `"API_TIMEOUT_MS": 3000000` with `json: cannot unmarshal number into Go struct field claudeSettings.env of type string`, refusing to launch Claude Code at all. The parser now coerces string, number, boolean, and null JSON scalars into their textual form — matching what Claude Code itself accepts and what OS env vars require. Composite values (objects/arrays) still error.

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
