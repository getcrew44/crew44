package model

import (
	"strings"
	"testing"
)

// Clarify normalization edges: out-of-range rec is cleared (not an error),
// missing question ids are auto-assigned, empty question text is invalid.
func TestExtractGoalMarkersClarifyNormalization(t *testing.T) {
	content := "<CREW44_GOAL_CLARIFY>\n" +
		"{\"questions\": [\n" +
		"  {\"q\": \"Which tests?\", \"type\": \"chips\", \"options\": [\"a\", \"b\"], \"rec\": 5},\n" +
		"  {\"q\": \"Off-limits?\", \"type\": \"text\"}\n" +
		"]}\n" +
		"</CREW44_GOAL_CLARIFY>"
	_, markers := ExtractGoalMarkers(content)
	if len(markers) != 1 || markers[0].Err != nil || markers[0].Clarify == nil {
		t.Fatalf("markers = %+v", markers)
	}
	qs := markers[0].Clarify.Questions
	if qs[0].Rec != nil {
		t.Fatalf("rec = %v, want cleared (out of range)", *qs[0].Rec)
	}
	if qs[0].ID != "q1" || qs[1].ID != "q2" {
		t.Fatalf("ids = %q, %q, want auto-assigned q1, q2", qs[0].ID, qs[1].ID)
	}

	empty := "<CREW44_GOAL_CLARIFY>\n" +
		"{\"questions\": [{\"q\": \"   \", \"type\": \"text\"}]}\n" +
		"</CREW44_GOAL_CLARIFY>"
	_, markers = ExtractGoalMarkers(empty)
	if len(markers) != 1 || markers[0].Err == nil {
		t.Fatalf("empty question text: markers = %+v, want Err", markers)
	}
	if !strings.Contains(markers[0].Err.Error(), "empty text") {
		t.Fatalf("err = %v", markers[0].Err)
	}
}

// Marker blocks with CRLF line endings (Windows-flavored runtime output)
// still match the line-anchored block regex.
func TestExtractGoalMarkersCRLF(t *testing.T) {
	content := "All set.\r\n<CREW44_GOAL_READY>\r\n{\"summary\": \"done\"}\r\n</CREW44_GOAL_READY>"
	cleaned, markers := ExtractGoalMarkers(content)
	if len(markers) != 1 || markers[0].Err != nil || markers[0].Ready == nil {
		t.Fatalf("markers = %+v", markers)
	}
	if markers[0].Ready.Summary != "done" {
		t.Fatalf("summary = %q", markers[0].Ready.Summary)
	}
	if strings.Contains(cleaned, "CREW44_GOAL_READY") {
		t.Fatalf("marker not stripped: %q", cleaned)
	}
}

// Auto-assigned criterion ids skip ids already taken by explicit entries.
func TestNormalizeGoalLockCriteriaIDCollision(t *testing.T) {
	out := NormalizeGoalLockCriteria([]GoalCriterion{
		{ID: "c2", Text: "explicitly second"},
		{Text: "needs an id"},
		{Text: "needs another id"},
	})
	if len(out) != 3 {
		t.Fatalf("criteria = %d, want 3", len(out))
	}
	if out[0].ID != "c2" {
		t.Fatalf("explicit id = %q, want c2 kept", out[0].ID)
	}
	if out[1].ID != "c1" {
		t.Fatalf("first auto id = %q, want c1", out[1].ID)
	}
	if out[2].ID != "c3" {
		t.Fatalf("second auto id = %q, want c3 (c2 taken)", out[2].ID)
	}
	for _, c := range out {
		if c.Status != GoalCriterionPending {
			t.Fatalf("criterion %q status = %q, want pending", c.ID, c.Status)
		}
	}
}
