package model

import (
	"strings"
	"testing"
)

func TestExtractGoalMarkersClarify(t *testing.T) {
	content := "Before I spin up the crew, three ambiguities.\n" +
		"<CREW44_GOAL_CLARIFY>\n" +
		"{\"intro\": \"Three ambiguities.\", \"questions\": [\n" +
		"  {\"id\": \"q1\", \"q\": \"Which tests define green?\", \"type\": \"chips\", \"options\": [\"onboarding only\", \"whole suite\"], \"rec\": 0},\n" +
		"  {\"id\": \"q2\", \"q\": \"Anything off-limits?\", \"type\": \"text\", \"placeholder\": \"e.g. CI config\"}\n" +
		"]}\n" +
		"</CREW44_GOAL_CLARIFY>"

	cleaned, markers := ExtractGoalMarkers(content)
	if cleaned != "Before I spin up the crew, three ambiguities." {
		t.Fatalf("cleaned = %q", cleaned)
	}
	if len(markers) != 1 {
		t.Fatalf("markers = %d, want 1", len(markers))
	}
	m := markers[0]
	if m.Kind != GoalMarkerClarify || m.Err != nil || m.Clarify == nil {
		t.Fatalf("marker = %+v", m)
	}
	if m.Clarify.Intro != "Three ambiguities." {
		t.Fatalf("intro = %q", m.Clarify.Intro)
	}
	if len(m.Clarify.Questions) != 2 {
		t.Fatalf("questions = %d, want 2", len(m.Clarify.Questions))
	}
	q1 := m.Clarify.Questions[0]
	if q1.ID != "q1" || q1.Type != "chips" || len(q1.Options) != 2 || q1.Rec == nil || *q1.Rec != 0 {
		t.Fatalf("q1 = %+v", q1)
	}
	if m.Clarify.Questions[1].Type != "text" {
		t.Fatalf("q2 = %+v", m.Clarify.Questions[1])
	}
}

func TestExtractGoalMarkersLockNormalizesIDs(t *testing.T) {
	content := "<CREW44_GOAL_LOCK>\n" +
		"{\"statement\": \"Suite verifiably stable\", \"criteria\": [\n" +
		"  {\"id\": \"c1\", \"text\": \"Green on 20 runs\", \"verify\": \"run_tests x20\"},\n" +
		"  {\"text\": \"No .only left behind\", \"verify\": \"grep gate\"},\n" +
		"  {\"id\": \"c1\", \"text\": \"Duplicate id gets reassigned\"},\n" +
		"  {\"text\": \"   \"}\n" +
		"]}\n" +
		"</CREW44_GOAL_LOCK>"

	cleaned, markers := ExtractGoalMarkers(content)
	if cleaned != "" {
		t.Fatalf("cleaned = %q, want empty", cleaned)
	}
	if len(markers) != 1 || markers[0].Err != nil || markers[0].Lock == nil {
		t.Fatalf("markers = %+v", markers)
	}
	criteria := markers[0].Lock.Criteria
	if len(criteria) != 3 {
		t.Fatalf("criteria = %d, want 3 (empty-text dropped)", len(criteria))
	}
	seen := map[string]bool{}
	for _, c := range criteria {
		if c.ID == "" {
			t.Fatalf("criterion %q has no id", c.Text)
		}
		if seen[c.ID] {
			t.Fatalf("duplicate id %q", c.ID)
		}
		seen[c.ID] = true
		if c.Status != GoalCriterionPending {
			t.Fatalf("criterion %q status = %q, want pending", c.ID, c.Status)
		}
	}
	if criteria[0].ID != "c1" {
		t.Fatalf("first criterion id = %q, want c1 kept", criteria[0].ID)
	}
}

func TestExtractGoalMarkersVerify(t *testing.T) {
	content := "Ran the gate.\n" +
		"<CREW44_GOAL_VERIFY>\n" +
		"{\"summary\": \"composer.flow flaked on run 13.\", \"results\": [\n" +
		"  {\"id\": \"c1\", \"status\": \"fail\", \"detail\": \"flaked on run 13\"},\n" +
		"  {\"id\": \"c2\", \"status\": \"pass\", \"detail\": \"clean\"}\n" +
		"]}\n" +
		"</CREW44_GOAL_VERIFY>\n" +
		"More work coming."

	cleaned, markers := ExtractGoalMarkers(content)
	if !strings.Contains(cleaned, "Ran the gate.") || !strings.Contains(cleaned, "More work coming.") {
		t.Fatalf("cleaned = %q", cleaned)
	}
	if strings.Contains(cleaned, "CREW44_GOAL_VERIFY") {
		t.Fatalf("marker not stripped: %q", cleaned)
	}
	if len(markers) != 1 || markers[0].Err != nil || markers[0].Verify == nil {
		t.Fatalf("markers = %+v", markers)
	}
	v := markers[0].Verify
	if v.Summary == "" || len(v.Results) != 2 || v.Results[0].Status != "fail" || v.Results[1].Status != "pass" {
		t.Fatalf("verify = %+v", v)
	}
}

func TestExtractGoalMarkersMultipleInOrder(t *testing.T) {
	content := "<CREW44_GOAL_LOCK>\n" +
		"{\"statement\": \"S\", \"criteria\": [{\"text\": \"c\"}]}\n" +
		"</CREW44_GOAL_LOCK>\n" +
		"middle text\n" +
		"<CREW44_GOAL_VERIFY>\n" +
		"{\"results\": [{\"id\": \"c1\", \"status\": \"pass\"}]}\n" +
		"</CREW44_GOAL_VERIFY>"

	cleaned, markers := ExtractGoalMarkers(content)
	if cleaned != "middle text" {
		t.Fatalf("cleaned = %q", cleaned)
	}
	if len(markers) != 2 || markers[0].Kind != GoalMarkerLock || markers[1].Kind != GoalMarkerVerify {
		t.Fatalf("markers = %+v", markers)
	}
}

func TestExtractGoalMarkersLineAnchoring(t *testing.T) {
	indented := "  <CREW44_GOAL_VERIFY>\n{\"results\": [{\"id\": \"c1\", \"status\": \"pass\"}]}\n  </CREW44_GOAL_VERIFY>"
	cleaned, markers := ExtractGoalMarkers(indented)
	if len(markers) != 0 {
		t.Fatalf("indented tags matched: %+v", markers)
	}
	if cleaned != indented {
		t.Fatalf("content changed: %q", cleaned)
	}

	inline := "prose <CREW44_GOAL_LOCK>\n{\"statement\": \"s\", \"criteria\": [{\"text\": \"c\"}]}\n</CREW44_GOAL_LOCK>"
	_, markers = ExtractGoalMarkers(inline)
	if len(markers) != 0 {
		t.Fatalf("inline opening tag matched: %+v", markers)
	}
}

func TestExtractGoalMarkersMalformedJSON(t *testing.T) {
	content := "Working on it.\n" +
		"<CREW44_GOAL_VERIFY>\n" +
		"{not json at all\n" +
		"</CREW44_GOAL_VERIFY>"

	cleaned, markers := ExtractGoalMarkers(content)
	if cleaned != "Working on it." {
		t.Fatalf("malformed block not stripped: %q", cleaned)
	}
	if len(markers) != 1 || markers[0].Err == nil {
		t.Fatalf("markers = %+v, want one with Err", markers)
	}
	if markers[0].Kind != GoalMarkerVerify {
		t.Fatalf("kind = %q", markers[0].Kind)
	}
}

func TestExtractGoalMarkersValidation(t *testing.T) {
	cases := []struct {
		name string
		body string
		tag  string
	}{
		{"clarify no questions", `{"intro": "x", "questions": []}`, "CLARIFY"},
		{"clarify bad type", `{"questions": [{"q": "x", "type": "dropdown"}]}`, "CLARIFY"},
		{"clarify chips one option", `{"questions": [{"q": "x", "type": "chips", "options": ["a"]}]}`, "CLARIFY"},
		{"lock empty statement", `{"statement": " ", "criteria": [{"text": "c"}]}`, "LOCK"},
		{"lock no criteria", `{"statement": "s", "criteria": []}`, "LOCK"},
		{"verify empty results", `{"results": []}`, "VERIFY"},
		{"verify bad status", `{"results": [{"id": "c1", "status": "maybe"}]}`, "VERIFY"},
		{"verify missing id", `{"results": [{"status": "pass"}]}`, "VERIFY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			content := "<CREW44_GOAL_" + tc.tag + ">\n" + tc.body + "\n</CREW44_GOAL_" + tc.tag + ">"
			cleaned, markers := ExtractGoalMarkers(content)
			if cleaned != "" {
				t.Fatalf("invalid block not stripped: %q", cleaned)
			}
			if len(markers) != 1 || markers[0].Err == nil {
				t.Fatalf("markers = %+v, want one with Err", markers)
			}
		})
	}
}

func TestExtractGoalMarkersCoexistsWithHandover(t *testing.T) {
	content := "Handing the fixture leak to Rae.\n" +
		"<CREW44_AGENT_HANDOVER agent_id=\"agent-rae\">bisect the teardown leak</CREW44_AGENT_HANDOVER>\n" +
		"<CREW44_GOAL_VERIFY>\n" +
		"{\"results\": [{\"id\": \"c1\", \"status\": \"fail\", \"detail\": \"run 13\"}]}\n" +
		"</CREW44_GOAL_VERIFY>"

	afterHandover, handovers := ExtractAgentHandoverMarkers(content)
	if len(handovers) != 1 || handovers[0].AgentID != "agent-rae" {
		t.Fatalf("handovers = %+v", handovers)
	}
	cleaned, goals := ExtractGoalMarkers(afterHandover)
	if cleaned != "Handing the fixture leak to Rae." {
		t.Fatalf("cleaned = %q", cleaned)
	}
	if len(goals) != 1 || goals[0].Err != nil || goals[0].Verify == nil {
		t.Fatalf("goals = %+v", goals)
	}
}

func TestStripGoalMarkersNoMarkers(t *testing.T) {
	content := "Just prose mentioning CREW44_GOAL_VERIFY inline, no block."
	cleaned, markers := ExtractGoalMarkers(content)
	if cleaned != content || len(markers) != 0 {
		t.Fatalf("cleaned = %q markers = %+v", cleaned, markers)
	}
}
