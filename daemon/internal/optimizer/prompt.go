package optimizer

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// BuildScanPrompt produces the message body posted to the Partner agent for
// each scan. Surfaces and threshold from the schedule are baked in so the
// agent does not waste tokens on filtered candidates.
func BuildScanPrompt(now time.Time, sched Schedule) string {
	return BuildScanPromptWithCorpus(now, sched, ScanCorpus{
		WindowStart: now.AddDate(0, 0, -7),
		WindowEnd:   now,
	})
}

func BuildScanPromptWithCorpus(now time.Time, sched Schedule, corpus ScanCorpus) string {
	windowStart := now.AddDate(0, 0, -7)
	if !corpus.WindowStart.IsZero() {
		windowStart = corpus.WindowStart
	}
	windowEnd := now
	if !corpus.WindowEnd.IsZero() {
		windowEnd = corpus.WindowEnd
	}
	var b strings.Builder
	b.WriteString("Run /session-skill-mining over the incremental project chat corpus from ")
	b.WriteString(windowStart.Format("2006-01-02 15:04 MST"))
	b.WriteString(" to ")
	b.WriteString(windowEnd.Format("2006-01-02 15:04 MST"))
	b.WriteString(".\n\n")

	b.WriteString("Look for two kinds of upgrades:\n")
	if sched.Surfaces.Skill {
		b.WriteString("- skill: reusable patterns worth codifying as a new SKILL.md\n")
	}
	if sched.Surfaces.Memory {
		b.WriteString("- memory-project: facts about a specific project worth pinning (include preview.scope_id with the project UUID)\n")
		b.WriteString("- memory-user: personal preferences (style, schedule, escalation patterns)\n")
	}
	b.WriteString("\n")
	b.WriteString("Strategy-shaped signals are still in scope: routing, scheduling, agent shape, cost, queueing, and role-boundary patterns. Do not emit a strategy kind; map it to either a skill or a memory:\n")
	b.WriteString("- skill when the strategy signal is a reusable decision or routing procedure.\n")
	b.WriteString("- memory-project or memory-user when the strategy signal is a durable fact, preference, constraint, or habit.\n\n")

	thresholdHint := map[string]string{
		"all":  "Emit everything you see.",
		"med":  "Drop low-confidence candidates; emit medium and high.",
		"high": "Emit only the high-impact candidates you are sure of.",
	}[sched.Threshold]
	if thresholdHint == "" {
		thresholdHint = "Drop low-confidence candidates."
	}
	b.WriteString(thresholdHint + "\n\n")

	b.WriteString("Quality bar — default to NOT surfacing. You are judged on signal-to-noise, not volume:\n")
	b.WriteString("- Reject framework or library boilerplate (anything documented in the framework's own quickstart — Electron IPC, React state lifting, etc.).\n")
	b.WriteString("- Reject patterns derivable in <60s by grepping or reading one existing file in the project. Code is the source of truth; do not duplicate it into prose.\n")
	b.WriteString("- Reject bug post-mortems whose fix already lives in code (merged commits, lint rules, types). The fix is the memory; propose a code comment via `kind: documentation` if anything.\n")
	b.WriteString("- Reject generic engineering advice (\"write tests,\" \"handle errors,\" \"read all files first\").\n")
	b.WriteString("- Reject mid-iteration noise. Gate on content quality, not session count. A skill candidate must be a complete reusable procedure with a stable trigger and ordered steps (one rich session is enough if the steps are crystallized; \"user fixed similar bugs twice this week\" is not). A memory candidate must be a durable fact, constraint, or stated preference that will still be true next week (one explicit user statement with a stated reason is enough; \"user touched this file twice today\" is not). In both cases, cite specific chat/turn IDs in evidence.runs and describe what makes the pattern stable, not how often it appeared.\n")
	b.WriteString("- Reject content already in CLAUDE.md, AGENTS.md, README.md, package.json scripts, or an existing SKILL.md.\n")
	b.WriteString("- An empty `suggestions` array is a valid, often correct, response. Prefer 0 strong over 5 weak — the user judges the next scan by the worst suggestion in this one.\n\n")

	b.WriteString("False-positive examples — Reject these even if they appear in 2 sessions:\n")
	b.WriteString("- Electron IPC main/preload/renderer as a skill: this is framework boilerplate and is derivable from any existing IPC handler in under 60 seconds.\n")
	b.WriteString("- overlay textarea scroll/overflow bugs as memory: this is a merged bug post-mortem; if the invariant matters, it belongs in the component as a code comment, type, lint rule, or refactor.\n")
	b.WriteString("- \"read all relevant files before writing code\" as a skill: this is generic engineering advice, not project-specific procedural memory.\n")
	b.WriteString("- 2 fixes in one component within a few days: this is active iteration, not a stable recurring pattern. Return {\"suggestions\":[]} rather than a weak candidate.\n\n")

	b.WriteString("Scan discipline:\n")
	b.WriteString("- The daemon already provided a bounded incremental corpus below. Treat it as the source of truth for this scan.\n")
	b.WriteString("- Do not run shell, filesystem, SQLite, or JSONL discovery to find more sessions unless the user explicitly asks later.\n")
	b.WriteString("- Use metadata-first scanning inside the corpus: list candidate chats with ids, timestamps, project, and short snippets before reading details.\n")
	b.WriteString("- Do not print raw transcript bodies, full database rows, full tool outputs, base64/blob fields, or unbounded command output.\n")
	b.WriteString("- Inspect only the small set of promising candidates needed for evidence; if coverage is limited, say so in scan_summary/rationale rather than dumping data.\n\n")

	b.WriteString("Incremental project chat corpus (daemon-bounded JSON; excludes optimizer-internal chats and tool outputs):\n")
	b.WriteString("```json\n")
	if data, err := json.MarshalIndent(corpus, "", "  "); err == nil {
		b.Write(data)
	} else {
		b.WriteString(`{"window_start":"","window_end":"","runs_analyzed":0,"chats":[]}`)
	}
	b.WriteString("\n```\n\n")

	b.WriteString("Reply with a brief plain-English summary, then a single fenced JSON code block matching this shape exactly. The JSON block is parsed by the daemon, so do not omit it:\n\n")
	b.WriteString("```json\n")
	b.WriteString(jsonSchemaExample())
	b.WriteString("\n```\n\n")
	b.WriteString("Rules:\n")
	b.WriteString("- schema_version must be 1.\n")
	b.WriteString("- Each suggestion id is a short hint like \"k-1\", \"m-1\", \"u-1\" (server rewrites to globally unique).\n")
	b.WriteString("- kind must be only skill, memory-project, or memory-user. Do not emit strategy suggestions.\n")
	b.WriteString("- preview.type matches kind: skill → skill, memory-* → memory.\n")
	b.WriteString("- For memory-project, set preview.scope_id to the project UUID the runs came from.\n")
	b.WriteString("- evidence.runs are chat/turn IDs you can quote. evidence.windows are short human-readable spans (\"3 lockfile-recovery sessions\").\n")
	b.WriteString("- If you cannot find any signals, return an empty suggestions array. Do not invent.\n")
	return b.String()
}

func jsonSchemaExample() string {
	return `{
  "schema_version": 1,
  "scan_summary": { "window": "2026-05-06..2026-05-13", "runs_analyzed": 142 },
  "suggestions": [
    {
      "id": "k-1",
      "kind": "skill",
      "priority": "high",
      "title": "Bundle the 6-step locale video prep into a skill",
      "body": "Milo runs the same prep ritual before every doubao-tts job: ...",
      "impact": "-4m/run",
      "evidence": { "runs": ["t-091","t-088"], "windows": ["5 runs, 8d window"] },
      "preview": {
        "type": "skill",
        "name": "locale-video-prep",
        "lines": ["# locale-video-prep", "", "Required reading before any locale promo render."]
      }
    },
    {
      "id": "m-1",
      "kind": "memory-project",
      "priority": "high",
      "title": "This repo uses pnpm workspaces; npm install breaks it",
      "body": "Three lockfile-recovery sessions in the last week...",
      "impact": "Prevents 10m/slip",
      "evidence": { "runs": ["t-114"], "windows": ["3 sessions, 7d"] },
      "preview": {
        "type": "memory",
        "scope": "crew44",
        "scope_id": "PASTE-PROJECT-UUID-HERE",
        "text": "Project uses pnpm workspaces. Never run npm install at the repo root."
      }
    }
  ]
}`
}

// ParseAgentResponse extracts the JSON envelope from the agent's reply.
// Returns the parsed envelope or an error if no valid fence was found.
type Envelope struct {
	SchemaVersion int            `json:"schema_version"`
	ScanSummary   ScanSummaryRaw `json:"scan_summary"`
	Suggestions   []Suggestion   `json:"suggestions"`
}

type ScanSummaryRaw struct {
	Window       string `json:"window"`
	RunsAnalyzed int    `json:"runs_analyzed"`
}

// extractFencedJSON finds the first ```json fence in text and returns its
// contents, or the whole top-level JSON object if no fence is present.
func extractFencedJSON(text string) (string, error) {
	lower := strings.ToLower(text)
	idx := strings.Index(lower, "```json")
	if idx >= 0 {
		rest := text[idx+len("```json"):]
		end := strings.Index(rest, "```")
		if end < 0 {
			return "", fmt.Errorf("unterminated json fence")
		}
		return strings.TrimSpace(rest[:end]), nil
	}
	// Fallback: first { ... matching }
	start := strings.Index(text, "{")
	if start < 0 {
		return "", fmt.Errorf("no json found in response")
	}
	depth := 0
	for i := start; i < len(text); i++ {
		switch text[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[start : i+1], nil
			}
		}
	}
	return "", fmt.Errorf("unbalanced braces in response")
}
