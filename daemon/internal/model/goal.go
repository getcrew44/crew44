package model

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Goal mode: a per-chat mode for long-running, verifiable tasks. The lead
// agent scopes the goal with structured questions, locks criteria into a
// verification gate, and the crew iterates until every criterion verifies.
// See docs/goal-0610.md.

type GoalPhase string

const (
	GoalPhaseScoping         GoalPhase = "scoping"
	GoalPhaseRunning         GoalPhase = "running"
	GoalPhaseAwaitingSignoff GoalPhase = "awaiting_signoff"
	GoalPhaseDone            GoalPhase = "done"
)

const (
	GoalCriterionPending  = "pending"
	GoalCriterionVerified = "verified"
	GoalCriterionFailed   = "failed"
)

// Verify result statuses (per criterion, from the verifier marker) and the
// overall/row verdicts carried on the goal_verify timeline payload.
const (
	GoalVerifyStatusPass = "pass"
	GoalVerifyStatusFail = "fail"

	GoalVerifyOverallPassed = "passed"
	GoalVerifyOverallFailed = "failed"
	GoalVerifyRowPending    = "pending"
)

// Structural caps on marker payloads — exceeding them is a validation error
// (the corrective-turn path), never a silent truncation.
const (
	GoalMaxClarifyQuestions = 10
	GoalMaxClarifyOptions   = 8
	GoalMaxLockCriteria     = 20
)

// Per-field length caps (in runes) for strings that get interpolated into
// system prompts. Statement, criterion text, and verify reject when over the
// cap; detail and summaries are evidence/prose and truncate instead.
const (
	GoalMaxStatementLen     = 200
	GoalMaxCriterionTextLen = 200
	GoalMaxVerifyLen        = 100
	GoalMaxDetailLen        = 500
	GoalMaxSummaryLen       = 500

	// Clarify prose fields truncate (never reject): they render in the UI and
	// interpolate into the lock prompt, so they get the collapse/cap treatment
	// of the other prompt-bound fields.
	GoalMaxClarifyIntroLen       = 300
	GoalMaxClarifyQuestionLen    = 200
	GoalMaxClarifyOptionLen      = 100
	GoalMaxClarifyPlaceholderLen = 150
)

// GoalDefaultAttemptCap bounds consecutive daemon-initiated gate
// continuations within one chat run. Any user action spawns a fresh run and
// re-arms the budget, so the loop can never permanently stall.
const GoalDefaultAttemptCap = 5

// The verification gate runs as a dedicated anonymous agent in an isolated
// turn — fresh session, no conversation history, no handover powers — so the
// crew's claims are checked independently instead of by the lead grading its
// own work. The verifier is daemon-synthesized (never a stored agent record);
// these constants are its actor identity on the timeline.
//
// NOTE: GOAL_VERIFIER in src/utils.js mirrors this identity for the frontend
// timeline — change one and you must change the other.
const (
	GoalVerifierAgentID   = "goal-verifier"
	GoalVerifierAgentName = "Verifier"
)

type GoalCriterion struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Verify string `json:"verify"`           // human-readable check method, e.g. "run_tests x20"
	Status string `json:"status"`           // pending | verified | failed
	Detail string `json:"detail,omitempty"` // last gate evidence, e.g. "flaked on run 13"
}

type GoalClarifyQuestion struct {
	ID          string   `json:"id"`
	Q           string   `json:"q"`
	Type        string   `json:"type"`                  // "chips" | "text"
	Options     []string `json:"options,omitempty"`     // chips only
	Rec         *int     `json:"rec,omitempty"`         // suggested option index, chips only
	Placeholder string   `json:"placeholder,omitempty"` // text only
}

type GoalState struct {
	Phase     GoalPhase       `json:"phase"`
	Statement string          `json:"statement,omitempty"`
	Criteria  []GoalCriterion `json:"criteria,omitempty"`
	// Questions is the pending clarify round during scoping; cleared on lock.
	// ClarifySeq is the events.jsonl seq of the goal_clarify event the
	// questions came from — only that event is interactive in the UI.
	Questions  []GoalClarifyQuestion `json:"questions,omitempty"`
	Answers    map[string]string     `json:"answers,omitempty"` // question_id -> final answer text
	ClarifySeq int64                 `json:"clarify_seq,omitempty"`
	Attempt    int                   `json:"attempt"`     // monotonic verify attempts since lock
	AttemptCap int                   `json:"attempt_cap"` // consecutive auto-continues per run
	LockedAt   time.Time             `json:"locked_at,omitempty"`
	DoneAt     time.Time             `json:"done_at,omitempty"`
	CreatedAt  time.Time             `json:"created_at"`
	UpdatedAt  time.Time             `json:"updated_at"`
}

type GoalClarifyPayload struct {
	Intro     string                `json:"intro,omitempty"`
	Questions []GoalClarifyQuestion `json:"questions"`
}

type GoalLockPayload struct {
	Statement string          `json:"statement"`
	Criteria  []GoalCriterion `json:"criteria"` // snapshot at lock, statuses all pending
}

type GoalVerifyRow struct {
	ID     string `json:"id"`
	Text   string `json:"text"`
	Verify string `json:"verify"`
	Status string `json:"status"` // pass | fail | pending (pending = not covered by results)
	Detail string `json:"detail,omitempty"`
}

type GoalVerifyPayload struct {
	Attempt int             `json:"attempt"`
	Overall string          `json:"overall"` // passed | failed
	Rows    []GoalVerifyRow `json:"rows"`
	Outcome string          `json:"outcome"`
}

type GoalDonePayload struct {
	Statement      string `json:"statement"`
	CriteriaTotal  int    `json:"criteria_total"`
	Attempts       int    `json:"attempts"`
	ElapsedSeconds int64  `json:"elapsed_seconds"`
}

type GoalSignoffPayload struct {
	Action string `json:"action"` // accept | send_back
	Notes  string `json:"notes,omitempty"`
}

// ── marker protocol ──────────────────────────────────────────────────────
//
// Goal markers are line-anchored multiline blocks with a raw JSON body:
// the opening tag alone at column 0, a JSON object, the closing tag alone
// at column 0. Unlike the single-line handover marker, goal payloads are
// structured, so the body spans lines.

type GoalMarkerKind string

const (
	GoalMarkerClarify GoalMarkerKind = "clarify"
	GoalMarkerLock    GoalMarkerKind = "lock"
	GoalMarkerReady   GoalMarkerKind = "ready"
	GoalMarkerVerify  GoalMarkerKind = "verify"
)

// GoalReadyMarker is the decoded body of a CREW44_GOAL_READY block — the
// lead's declaration that the goal should verify. It triggers an isolated
// verifier turn; it never opens the gate by itself.
type GoalReadyMarker struct {
	Summary string `json:"summary,omitempty"`
}

type GoalVerifyResult struct {
	ID     string `json:"id"`
	Status string `json:"status"` // pass | fail
	Detail string `json:"detail,omitempty"`
}

// GoalVerifyMarker is the decoded body of a CREW44_GOAL_VERIFY block, before
// the daemon maps results onto the locked criteria.
type GoalVerifyMarker struct {
	Summary string             `json:"summary,omitempty"`
	Results []GoalVerifyResult `json:"results"`
}

// GoalMarker is one extracted goal marker block. Exactly one of Clarify,
// Lock, Ready, Verify is set when Err is nil; a non-nil Err means the block
// was recognized (and stripped) but its JSON body failed to decode or
// validate.
type GoalMarker struct {
	Kind    GoalMarkerKind
	Clarify *GoalClarifyPayload
	Lock    *GoalLockPayload
	Ready   *GoalReadyMarker
	Verify  *GoalVerifyMarker
	Err     error
}

// Go RE2 has no backreferences, so each marker kind gets its own
// line-anchored block regex sharing one shape.
func goalBlockRe(tag string) *regexp.Regexp {
	// Both tag lines tolerate CRLF: the opening via the explicit \r?\n, the
	// closing via \r?$ — `$` in multiline mode matches before \n but not
	// before \r, so without it CRLF-terminated blocks would never match and
	// the raw tags would leak to the timeline.
	return regexp.MustCompile(`(?ms)^<CREW44_GOAL_` + tag + `>[ \t]*\r?\n(.*?)\r?\n^</CREW44_GOAL_` + tag + `>[ \t]*\r?$`)
}

var goalBlockRes = map[GoalMarkerKind]*regexp.Regexp{
	GoalMarkerClarify: goalBlockRe("CLARIFY"),
	GoalMarkerLock:    goalBlockRe("LOCK"),
	GoalMarkerReady:   goalBlockRe("READY"),
	GoalMarkerVerify:  goalBlockRe("VERIFY"),
}

type goalBlockMatch struct {
	start int
	end   int
	kind  GoalMarkerKind
	body  string
}

// fencedRanges returns the byte ranges of markdown fenced code regions —
// lines opened by ``` or ~~~ (any info string) and closed by a fence of the
// same character at least as long. Goal marker blocks inside these ranges
// are quotes, not commands, so extraction and stripping skip them. An
// unclosed fence is treated as running to the end of the message: a
// half-quoted marker must never execute.
func fencedRanges(content string) [][2]int {
	var ranges [][2]int
	openStart := -1
	var openChar byte
	openLen := 0
	pos := 0
	for pos < len(content) {
		lineEnd := strings.IndexByte(content[pos:], '\n')
		var line string
		var next int
		if lineEnd < 0 {
			line = content[pos:]
			next = len(content)
		} else {
			line = content[pos : pos+lineEnd]
			next = pos + lineEnd + 1
		}
		ch, n, rest := fenceLine(line)
		if openStart < 0 {
			if n >= 3 {
				openStart = pos
				openChar = ch
				openLen = n
			}
		} else if ch == openChar && n >= openLen && strings.TrimSpace(rest) == "" {
			ranges = append(ranges, [2]int{openStart, next})
			openStart = -1
		}
		pos = next
	}
	if openStart >= 0 {
		ranges = append(ranges, [2]int{openStart, len(content)})
	}
	return ranges
}

// fenceLine reports the fence character ('`' or '~'), run length, and the
// remainder (info string) when line is a markdown code fence line (up to
// three spaces of indentation, then three or more fence characters). A zero
// run length means the line is not a fence.
func fenceLine(line string) (byte, int, string) {
	s := line
	for i := 0; i < 3 && s != "" && s[0] == ' '; i++ {
		s = s[1:]
	}
	if s == "" || (s[0] != '`' && s[0] != '~') {
		return 0, 0, ""
	}
	ch := s[0]
	n := 0
	for n < len(s) && s[n] == ch {
		n++
	}
	if n < 3 {
		return 0, 0, ""
	}
	return ch, n, s[n:]
}

func insideFencedRange(ranges [][2]int, offset int) bool {
	for _, r := range ranges {
		if offset >= r[0] && offset < r[1] {
			return true
		}
	}
	return false
}

// goalBlockMatches finds every goal marker block outside markdown fenced
// code regions, in document order. Extraction and stripping share this so a
// fenced (quoted) marker is consistently neither parsed nor stripped.
//
// Blocks overlapping an earlier block's range (e.g. a marker of one kind
// quoted inside another's body, or two blocks interleaved tag-in-tag) are
// quotes/garbage, not commands: they are dropped from the result so they are
// never parsed, and the surviving block's range is extended over them so
// stripping leaves no dangling closing tag behind.
func goalBlockMatches(content string) []goalBlockMatch {
	var blocks []goalBlockMatch
	var fences [][2]int
	fencesComputed := false
	for kind, re := range goalBlockRes {
		for _, idx := range re.FindAllStringSubmatchIndex(content, -1) {
			if !fencesComputed {
				fences = fencedRanges(content)
				fencesComputed = true
			}
			if insideFencedRange(fences, idx[0]) {
				continue
			}
			blocks = append(blocks, goalBlockMatch{
				start: idx[0],
				end:   idx[1],
				kind:  kind,
				body:  content[idx[2]:idx[3]],
			})
		}
	}
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].start < blocks[j].start })
	merged := blocks[:0]
	for _, block := range blocks {
		if len(merged) > 0 && block.start < merged[len(merged)-1].end {
			if block.end > merged[len(merged)-1].end {
				merged[len(merged)-1].end = block.end
			}
			continue
		}
		merged = append(merged, block)
	}
	return merged
}

// ExtractGoalMarkers strips all goal marker blocks from content (mirroring
// StripAgentHandoverMarkers) and returns the parsed markers in document
// order. Malformed bodies are still stripped; they come back with Err set so
// the caller can surface a structured failure instead of leaking raw JSON to
// the timeline. Marker blocks inside markdown fenced code regions, or nested
// inside another marker block's range, are quotes, not commands: fenced
// blocks are neither parsed nor stripped; nested blocks are stripped with
// their host but never parsed.
func ExtractGoalMarkers(content string) (string, []GoalMarker) {
	blocks := goalBlockMatches(content)
	if len(blocks) == 0 {
		return content, nil
	}
	markers := make([]GoalMarker, 0, len(blocks))
	for _, block := range blocks {
		markers = append(markers, parseGoalMarker(block.kind, block.body))
	}
	return stripGoalBlocks(content, blocks), markers
}

func StripGoalMarkers(content string) string {
	return stripGoalBlocks(content, goalBlockMatches(content))
}

func stripGoalBlocks(content string, blocks []goalBlockMatch) string {
	if len(blocks) == 0 {
		return strings.TrimSpace(content)
	}
	// goalBlockMatches already merged nested/overlapping blocks, so the
	// ranges here are disjoint and ascending.
	var b strings.Builder
	prev := 0
	for _, block := range blocks {
		b.WriteString(content[prev:block.start])
		prev = block.end
	}
	b.WriteString(content[prev:])
	return strings.TrimSpace(b.String())
}

func parseGoalMarker(kind GoalMarkerKind, body string) GoalMarker {
	marker := GoalMarker{Kind: kind}
	switch kind {
	case GoalMarkerClarify:
		payload := &GoalClarifyPayload{}
		if err := json.Unmarshal([]byte(body), payload); err != nil {
			marker.Err = fmt.Errorf("invalid CREW44_GOAL_CLARIFY body: %w", err)
			return marker
		}
		if err := validateClarifyPayload(payload); err != nil {
			marker.Err = err
			return marker
		}
		marker.Clarify = payload
	case GoalMarkerLock:
		payload := &GoalLockPayload{}
		if err := json.Unmarshal([]byte(body), payload); err != nil {
			marker.Err = fmt.Errorf("invalid CREW44_GOAL_LOCK body: %w", err)
			return marker
		}
		if err := validateLockPayload(payload); err != nil {
			marker.Err = err
			return marker
		}
		marker.Lock = payload
	case GoalMarkerReady:
		payload := &GoalReadyMarker{}
		if err := json.Unmarshal([]byte(body), payload); err != nil {
			marker.Err = fmt.Errorf("invalid CREW44_GOAL_READY body: %w", err)
			return marker
		}
		payload.Summary = truncatePromptField(collapsePromptField(payload.Summary), GoalMaxSummaryLen)
		marker.Ready = payload
	case GoalMarkerVerify:
		payload := &GoalVerifyMarker{}
		if err := json.Unmarshal([]byte(body), payload); err != nil {
			marker.Err = fmt.Errorf("invalid CREW44_GOAL_VERIFY body: %w", err)
			return marker
		}
		if err := validateVerifyMarker(payload); err != nil {
			marker.Err = err
			return marker
		}
		marker.Verify = payload
	}
	return marker
}

func validateClarifyPayload(payload *GoalClarifyPayload) error {
	if len(payload.Questions) == 0 {
		return fmt.Errorf("CREW44_GOAL_CLARIFY needs at least one question")
	}
	if len(payload.Questions) > GoalMaxClarifyQuestions {
		return fmt.Errorf("CREW44_GOAL_CLARIFY has %d questions (max %d)", len(payload.Questions), GoalMaxClarifyQuestions)
	}
	// Prose fields are collapsed and capped (truncated, never rejected) like
	// the other prompt-bound marker fields: they render in the UI and feed
	// the lock prompt via the answers map.
	payload.Intro = truncatePromptField(collapsePromptField(payload.Intro), GoalMaxClarifyIntroLen)
	// Explicit duplicate question ids are deduped by reassignment (the
	// NormalizeGoalLockCriteria approach) so React keys and the answer map
	// can never collide.
	seen := map[string]bool{}
	for i := range payload.Questions {
		q := &payload.Questions[i]
		q.Q = collapsePromptField(q.Q)
		if q.Q == "" {
			return fmt.Errorf("CREW44_GOAL_CLARIFY question %d has empty text", i+1)
		}
		q.Q = truncatePromptField(q.Q, GoalMaxClarifyQuestionLen)
		q.ID = strings.TrimSpace(q.ID)
		if q.ID == "" || seen[q.ID] {
			q.ID = ""
		} else {
			seen[q.ID] = true
		}
	}
	for i := range payload.Questions {
		if payload.Questions[i].ID != "" {
			continue
		}
		for n := 1; ; n++ {
			candidate := fmt.Sprintf("q%d", n)
			if !seen[candidate] {
				payload.Questions[i].ID = candidate
				seen[candidate] = true
				break
			}
		}
	}
	for i := range payload.Questions {
		q := &payload.Questions[i]
		q.Placeholder = truncatePromptField(collapsePromptField(q.Placeholder), GoalMaxClarifyPlaceholderLen)
		switch q.Type {
		case "chips":
			if len(q.Options) < 2 {
				return fmt.Errorf("CREW44_GOAL_CLARIFY chips question %q needs at least two options", q.ID)
			}
			if len(q.Options) > GoalMaxClarifyOptions {
				return fmt.Errorf("CREW44_GOAL_CLARIFY chips question %q has %d options (max %d)", q.ID, len(q.Options), GoalMaxClarifyOptions)
			}
			for j := range q.Options {
				q.Options[j] = truncatePromptField(collapsePromptField(q.Options[j]), GoalMaxClarifyOptionLen)
			}
			if q.Rec != nil && (*q.Rec < 0 || *q.Rec >= len(q.Options)) {
				q.Rec = nil
			}
		case "text":
		default:
			return fmt.Errorf("CREW44_GOAL_CLARIFY question %q has unknown type %q (want chips or text)", q.ID, q.Type)
		}
	}
	return nil
}

func validateLockPayload(payload *GoalLockPayload) error {
	payload.Statement = collapsePromptField(payload.Statement)
	if payload.Statement == "" {
		return fmt.Errorf("CREW44_GOAL_LOCK needs a non-empty statement")
	}
	if utf8.RuneCountInString(payload.Statement) > GoalMaxStatementLen {
		return fmt.Errorf("CREW44_GOAL_LOCK statement is %d characters (max %d)", utf8.RuneCountInString(payload.Statement), GoalMaxStatementLen)
	}
	payload.Criteria = NormalizeGoalLockCriteria(payload.Criteria)
	if len(payload.Criteria) == 0 {
		return fmt.Errorf("CREW44_GOAL_LOCK needs at least one criterion with text")
	}
	if len(payload.Criteria) > GoalMaxLockCriteria {
		return fmt.Errorf("CREW44_GOAL_LOCK has %d criteria (max %d)", len(payload.Criteria), GoalMaxLockCriteria)
	}
	for _, c := range payload.Criteria {
		if utf8.RuneCountInString(c.Text) > GoalMaxCriterionTextLen {
			return fmt.Errorf("CREW44_GOAL_LOCK criterion %q text is %d characters (max %d)", c.ID, utf8.RuneCountInString(c.Text), GoalMaxCriterionTextLen)
		}
		if utf8.RuneCountInString(c.Verify) > GoalMaxVerifyLen {
			return fmt.Errorf("CREW44_GOAL_LOCK criterion %q verify is %d characters (max %d)", c.ID, utf8.RuneCountInString(c.Verify), GoalMaxVerifyLen)
		}
	}
	return nil
}

func validateVerifyMarker(payload *GoalVerifyMarker) error {
	if len(payload.Results) == 0 {
		return fmt.Errorf("CREW44_GOAL_VERIFY needs at least one result")
	}
	payload.Summary = truncatePromptField(collapsePromptField(payload.Summary), GoalMaxSummaryLen)
	// Duplicate criterion ids merge fail-closed: once an id has failed, a
	// later "pass" for the same id can never upgrade it back.
	merged := make([]GoalVerifyResult, 0, len(payload.Results))
	index := map[string]int{}
	for i := range payload.Results {
		r := payload.Results[i]
		r.ID = strings.TrimSpace(r.ID)
		if r.ID == "" {
			return fmt.Errorf("CREW44_GOAL_VERIFY result %d has no criterion id", i+1)
		}
		if r.Status != GoalVerifyStatusPass && r.Status != GoalVerifyStatusFail {
			return fmt.Errorf("CREW44_GOAL_VERIFY result %q has status %q (want pass or fail)", r.ID, r.Status)
		}
		r.Detail = truncatePromptField(collapsePromptField(r.Detail), GoalMaxDetailLen)
		if at, ok := index[r.ID]; ok {
			if r.Status == GoalVerifyStatusFail && merged[at].Status != GoalVerifyStatusFail {
				merged[at].Status = GoalVerifyStatusFail
				merged[at].Detail = r.Detail
			}
			continue
		}
		index[r.ID] = len(merged)
		merged = append(merged, r)
	}
	payload.Results = merged
	return nil
}

// NormalizeGoalLockCriteria trims criterion fields (collapsing newlines and
// control characters, since these strings are interpolated into system
// prompts), drops entries without text, resets statuses to pending, and
// assigns sequential IDs (c1..cN) to entries with missing or duplicate IDs.
func NormalizeGoalLockCriteria(criteria []GoalCriterion) []GoalCriterion {
	out := make([]GoalCriterion, 0, len(criteria))
	seen := map[string]bool{}
	for _, c := range criteria {
		c.Text = collapsePromptField(c.Text)
		if c.Text == "" {
			continue
		}
		c.Verify = collapsePromptField(c.Verify)
		c.ID = strings.TrimSpace(c.ID)
		if c.ID == "" || seen[c.ID] {
			c.ID = ""
		}
		c.Status = GoalCriterionPending
		c.Detail = ""
		out = append(out, c)
		if c.ID != "" {
			seen[c.ID] = true
		}
	}
	for i := range out {
		if out[i].ID != "" {
			continue
		}
		for n := 1; ; n++ {
			candidate := fmt.Sprintf("c%d", n)
			if !seen[candidate] {
				out[i].ID = candidate
				seen[candidate] = true
				break
			}
		}
	}
	return out
}

// NormalizeGoalPromptField collapses a prompt-bound goal field the same way
// marker parsing does before those fields are interpolated into system
// prompts.
func NormalizeGoalPromptField(s string) string {
	return collapsePromptField(s)
}

// collapsePromptField collapses newlines, tabs, control characters, and
// space runs to single spaces and trims the result. These fields are
// interpolated into system prompts, where a raw newline could forge new
// prompt sections.
func collapsePromptField(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	lastSpace := false
	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\t' || unicode.IsControl(r) {
			r = ' '
		}
		if r == ' ' {
			if lastSpace {
				continue
			}
			lastSpace = true
		} else {
			lastSpace = false
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// truncatePromptField caps s at max runes, trimming any trailing space the
// cut leaves behind.
func truncatePromptField(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return strings.TrimSpace(string(runes[:max]))
}
