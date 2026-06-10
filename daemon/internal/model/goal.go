package model

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
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

// GoalDefaultAttemptCap bounds consecutive daemon-initiated gate
// continuations within one chat run. Any user action spawns a fresh run and
// re-arms the budget, so the loop can never permanently stall.
const GoalDefaultAttemptCap = 5

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
	GoalMarkerVerify  GoalMarkerKind = "verify"
)

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
// Lock, Verify is set when Err is nil; a non-nil Err means the block was
// recognized (and stripped) but its JSON body failed to decode or validate.
type GoalMarker struct {
	Kind    GoalMarkerKind
	Clarify *GoalClarifyPayload
	Lock    *GoalLockPayload
	Verify  *GoalVerifyMarker
	Err     error
}

// Go RE2 has no backreferences, so each marker kind gets its own
// line-anchored block regex sharing one shape.
func goalBlockRe(tag string) *regexp.Regexp {
	return regexp.MustCompile(`(?ms)^<CREW44_GOAL_` + tag + `>[ \t]*\r?\n(.*?)\r?\n^</CREW44_GOAL_` + tag + `>[ \t]*$`)
}

var goalBlockRes = map[GoalMarkerKind]*regexp.Regexp{
	GoalMarkerClarify: goalBlockRe("CLARIFY"),
	GoalMarkerLock:    goalBlockRe("LOCK"),
	GoalMarkerVerify:  goalBlockRe("VERIFY"),
}

type goalBlockMatch struct {
	start int
	kind  GoalMarkerKind
	body  string
}

// ExtractGoalMarkers strips all goal marker blocks from content (mirroring
// StripAgentHandoverMarkers) and returns the parsed markers in document
// order. Malformed bodies are still stripped; they come back with Err set so
// the caller can surface a structured failure instead of leaking raw JSON to
// the timeline.
func ExtractGoalMarkers(content string) (string, []GoalMarker) {
	var blocks []goalBlockMatch
	for kind, re := range goalBlockRes {
		for _, idx := range re.FindAllStringSubmatchIndex(content, -1) {
			blocks = append(blocks, goalBlockMatch{
				start: idx[0],
				kind:  kind,
				body:  content[idx[2]:idx[3]],
			})
		}
	}
	if len(blocks) == 0 {
		return content, nil
	}
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].start < blocks[j].start })
	markers := make([]GoalMarker, 0, len(blocks))
	for _, block := range blocks {
		markers = append(markers, parseGoalMarker(block.kind, block.body))
	}
	return StripGoalMarkers(content), markers
}

func StripGoalMarkers(content string) string {
	for _, re := range goalBlockRes {
		content = re.ReplaceAllString(content, "")
	}
	return strings.TrimSpace(content)
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
	for i := range payload.Questions {
		q := &payload.Questions[i]
		q.Q = strings.TrimSpace(q.Q)
		if q.Q == "" {
			return fmt.Errorf("CREW44_GOAL_CLARIFY question %d has empty text", i+1)
		}
		if strings.TrimSpace(q.ID) == "" {
			q.ID = fmt.Sprintf("q%d", i+1)
		}
		switch q.Type {
		case "chips":
			if len(q.Options) < 2 {
				return fmt.Errorf("CREW44_GOAL_CLARIFY chips question %q needs at least two options", q.ID)
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
	payload.Statement = strings.TrimSpace(payload.Statement)
	if payload.Statement == "" {
		return fmt.Errorf("CREW44_GOAL_LOCK needs a non-empty statement")
	}
	payload.Criteria = NormalizeGoalLockCriteria(payload.Criteria)
	if len(payload.Criteria) == 0 {
		return fmt.Errorf("CREW44_GOAL_LOCK needs at least one criterion with text")
	}
	return nil
}

func validateVerifyMarker(payload *GoalVerifyMarker) error {
	if len(payload.Results) == 0 {
		return fmt.Errorf("CREW44_GOAL_VERIFY needs at least one result")
	}
	for i := range payload.Results {
		r := &payload.Results[i]
		r.ID = strings.TrimSpace(r.ID)
		if r.ID == "" {
			return fmt.Errorf("CREW44_GOAL_VERIFY result %d has no criterion id", i+1)
		}
		if r.Status != "pass" && r.Status != "fail" {
			return fmt.Errorf("CREW44_GOAL_VERIFY result %q has status %q (want pass or fail)", r.ID, r.Status)
		}
	}
	return nil
}

// NormalizeGoalLockCriteria trims criterion fields, drops entries without
// text, resets statuses to pending, and assigns sequential IDs (c1..cN) to
// entries with missing or duplicate IDs.
func NormalizeGoalLockCriteria(criteria []GoalCriterion) []GoalCriterion {
	out := make([]GoalCriterion, 0, len(criteria))
	seen := map[string]bool{}
	for _, c := range criteria {
		c.Text = strings.TrimSpace(c.Text)
		if c.Text == "" {
			continue
		}
		c.Verify = strings.TrimSpace(c.Verify)
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
