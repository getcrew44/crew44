package prompt

import (
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

func signoffGoal(phase model.GoalPhase) *model.GoalState {
	return &model.GoalState{
		Phase:     phase,
		Statement: "Onboarding suite verifiably stable",
		Criteria: []model.GoalCriterion{
			{ID: "c1", Text: "Green on 20 runs", Verify: "run_tests x20", Status: model.GoalCriterionVerified, Detail: "20/20"},
		},
	}
}

// The lead's awaiting_signoff/done section: gate open, criteria listed, and
// the re-ready protocol for a send-back. Never asserted by the app-level
// tests, which stop at the running phase prompt.
func TestGoalModeSectionSignoffPhases(t *testing.T) {
	for _, phase := range []model.GoalPhase{model.GoalPhaseAwaitingSignoff, model.GoalPhaseDone} {
		section := goalModeSection(signoffGoal(phase), true)
		if !strings.Contains(section, "gate is open") {
			t.Fatalf("phase %q: section missing open-gate framing: %q", phase, section)
		}
		if !strings.Contains(section, "Onboarding suite verifiably stable") {
			t.Fatalf("phase %q: section missing statement", phase)
		}
		if !strings.Contains(section, "CREW44_GOAL_READY") {
			t.Fatalf("phase %q: section missing the re-ready protocol for send-backs", phase)
		}
		if !strings.Contains(section, "Green on 20 runs") {
			t.Fatalf("phase %q: section missing criteria", phase)
		}
	}
}

// Unknown phases render no section rather than leaking a half-built prompt.
func TestGoalModeSectionUnknownPhaseEmpty(t *testing.T) {
	if got := goalModeSection(signoffGoal("exploded"), true); got != "" {
		t.Fatalf("unknown phase section = %q, want empty", got)
	}
}

// Non-lead participants get no goal context during scoping — nothing is
// locked yet, so there is nothing actionable to show them.
func TestGoalContextForParticipantScopingEmpty(t *testing.T) {
	goal := &model.GoalState{Phase: model.GoalPhaseScoping}
	if got := goalModeSection(goal, false); got != "" {
		t.Fatalf("participant scoping section = %q, want empty", got)
	}
}

// Every per-phase instruction block quotes its marker examples inside a
// fenced code region — so a model echoing its instructions verbatim emits an
// inert (fenced) block — and carries the plain-text/no-fence rule right next
// to it. Running marker extraction over the instruction text itself must
// therefore find zero live markers.
func TestGoalInstructionExamplesAreInert(t *testing.T) {
	goal := signoffGoal(model.GoalPhaseRunning)
	sections := map[string]string{
		"scoping":  goalScopingInstructions(),
		"running":  goalRunningInstructions(goal),
		"signoff":  goalSignoffInstructions(goal),
		"verifier": goalVerifierInstructions(goal),
	}
	for name, section := range sections {
		if _, markers := model.ExtractGoalMarkers(section); len(markers) != 0 {
			t.Fatalf("%s instructions contain a live (unfenced) marker block", name)
		}
		if !strings.Contains(section, "NEVER wrap") {
			t.Fatalf("%s instructions missing the no-fence rule: %q", name, section)
		}
	}
	// The blocks with examples actually fence them (signoff has no example).
	for _, name := range []string{"scoping", "running", "verifier"} {
		if !strings.Contains(sections[name], "```text") {
			t.Fatalf("%s instructions example not fenced", name)
		}
	}
}

// Criterion rows include verify method and last gate evidence when present.
func TestWriteGoalCriteriaDetailRendering(t *testing.T) {
	var b strings.Builder
	writeGoalCriteria(&b, []model.GoalCriterion{
		{ID: "c1", Text: "Green", Verify: "ci", Status: model.GoalCriterionFailed, Detail: "flaked on run 13"},
		{ID: "c2", Text: "Clean", Status: model.GoalCriterionPending},
	})
	out := b.String()
	if !strings.Contains(out, "[failed] Green (id: c1, verify: ci, last result: flaked on run 13)") {
		t.Fatalf("failed row malformed: %q", out)
	}
	if !strings.Contains(out, "[pending] Clean (id: c2)") {
		t.Fatalf("pending row should omit empty verify/detail: %q", out)
	}
}
