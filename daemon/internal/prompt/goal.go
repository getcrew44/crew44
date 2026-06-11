package prompt

import (
	"fmt"
	"strings"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

// goalModeSection renders the per-phase Goal Mode instructions. The clarify,
// lock, and ready markers are lead-only; the verify marker belongs to the
// isolated verifier turn (goalVerifierInstructions). Delegated agents get a
// read-only view of the goal so they know the definition of done, and the
// daemon ignores goal markers from anyone they don't belong to.
func goalModeSection(goal *model.GoalState, isLead bool) string {
	if !isLead {
		return goalContextForParticipant(goal)
	}
	switch goal.Phase {
	case model.GoalPhaseScoping:
		return goalScopingInstructions()
	case model.GoalPhaseRunning:
		return goalRunningInstructions(goal)
	case model.GoalPhaseAwaitingSignoff, model.GoalPhaseDone:
		return goalSignoffInstructions(goal)
	default:
		return ""
	}
}

// goalMarkerPlainTextRule is the anti-fence rule that follows every quoted
// marker example: extraction treats fenced marker blocks as quotes, so a
// model that fences its own marker emits a no-op.
const goalMarkerPlainTextRule = "Emit your marker as plain text starting at column 0 — NEVER wrap it in a markdown code fence (a fenced marker is treated as a quote and ignored). The example above is fenced only because it is a quote."

// goalMarkerExample quotes an example marker block inside a fenced code
// region so a model echoing its instructions verbatim emits an inert block —
// marker extraction skips fenced regions.
func goalMarkerExample(block string) string {
	return "```text\n" + block + "\n```"
}

func goalScopingInstructions() string {
	return `This chat is in Goal mode and the goal is NOT yet locked. Do not start implementation work.

First, ask 2-5 clarifying questions that pin down what "done" means, using exactly one CREW44_GOAL_CLARIFY block. Format: the opening tag alone on one line, a JSON body, the closing tag alone on one line. Example:

` + goalMarkerExample(`<CREW44_GOAL_CLARIFY>
{"intro": "One sentence on why you are asking.",
 "questions": [
   {"id": "q1", "q": "Which tests define green?", "type": "chips",
    "options": ["onboarding/** only", "Whole frontend suite"], "rec": 0},
   {"id": "q2", "q": "Anything off-limits?", "type": "text",
    "placeholder": "e.g. don't touch the CI config"}
 ]}
</CREW44_GOAL_CLARIFY>`) + `

` + goalMarkerPlainTextRule + `

Rules:
- Prefer "chips" questions with 2-4 mutually exclusive options; mark a suggested option with "rec" (zero-based index).
- Use "text" only when free-form input is genuinely needed.
- Ask only what changes the goal's criteria. Do not pad.

When the user's answers arrive, lock the goal with exactly one CREW44_GOAL_LOCK block. Example:

` + goalMarkerExample(`<CREW44_GOAL_LOCK>
{"statement": "One sentence stating the verifiable end state.",
 "criteria": [
   {"id": "c1", "text": "onboarding/** green on 20 consecutive runs", "verify": "run_tests x20"},
   {"id": "c2", "text": "No .only or .skip left behind", "verify": "grep gate"}
 ]}
</CREW44_GOAL_LOCK>`) + `

` + goalMarkerPlainTextRule + `

Rules:
- 3-7 criteria. Every criterion MUST be objectively checkable with your own tools (run tests, grep, lint, measure); "verify" names the check.
- Criteria define done. Vague criteria ("code is clean") are not lockable — make them measurable.
- Keep it terse — these render as one-line checklist rows. The statement is one sentence of at most ~12 words. Each criterion "text" is a single checkable clause of at most ~12 words. "verify" is a short check label of at most ~4 words (like "run_tests x20" or "grep gate"), never a sentence — how-to-check specifics belong in the verify run's "detail" evidence, not in the checklist.
- Locking starts the work immediately — after the lock block, the crew begins executing without waiting for the user. Do not ask for permission to proceed.`
}

func goalRunningInstructions(goal *model.GoalState) string {
	var b strings.Builder
	b.WriteString("This chat is in Goal mode. The goal is locked; the verification gate holds the task open until every criterion verifies.\n\n")
	fmt.Fprintf(&b, "Goal: %s\n", goal.Statement)
	fmt.Fprintf(&b, "Verification attempt: %d\n", goal.Attempt)
	b.WriteString("Criteria (the definition of done):\n")
	writeGoalCriteria(&b, goal.Criteria)
	b.WriteString(`
Rules:
- The criteria above are the definition of done. The user may edit them between turns, so always trust this list over memory.
- Work toward the goal. Delegate via handover when another agent fits better.
- When you believe every criterion is met, declare the goal ready with exactly one CREW44_GOAL_READY block — an independent verifier then checks every criterion in an isolated turn. Example:

` + goalMarkerExample(`<CREW44_GOAL_READY>
{"summary": "One sentence on why the goal should verify."}
</CREW44_GOAL_READY>`) + `

- ` + goalMarkerPlainTextRule + `
- Verification is not yours to run: never emit CREW44_GOAL_VERIFY — that marker belongs to the independent verifier, and the daemon ignores it from anyone else.
- Declare ready only after you have confirmed the work is complete yourself; a held gate costs an attempt.
- Never claim completion without the marker. Never end your turn without a handover, an explicit question for the user, or a ready declaration.`)
	return b.String()
}

func goalSignoffInstructions(goal *model.GoalState) string {
	var b strings.Builder
	b.WriteString("This chat is in Goal mode. Every criterion verified — the gate is open and the user is reviewing the result.\n\n")
	fmt.Fprintf(&b, "Goal: %s\n", goal.Statement)
	b.WriteString("Criteria:\n")
	writeGoalCriteria(&b, goal.Criteria)
	b.WriteString("\nIf the user sends the task back or asks for further changes, address them, then declare readiness again with the CREW44_GOAL_READY marker — it re-arms the gate (every criterion resets to pending) and the independent verifier re-runs it.")
	b.WriteString("\nEmit the marker as plain text starting at column 0 — NEVER wrap it in a markdown code fence (a fenced marker is treated as a quote and ignored).")
	return b.String()
}

// goalVerifierInstructions is the system-prompt section for the isolated
// verifier turn. The verifier is anonymous and stateless on purpose: it gets
// no conversation history, no handover powers, and must produce every piece
// of evidence itself instead of trusting the crew's claims.
func goalVerifierInstructions(goal *model.GoalState) string {
	var b strings.Builder
	b.WriteString("You are the independent verification gate for this task — a dedicated, anonymous verifier, not a member of the crew. The crew claims the goal is met; your only job is to check that claim from scratch with your own tools.\n\n")
	fmt.Fprintf(&b, "Goal: %s\n", goal.Statement)
	b.WriteString("Criteria (the definition of done):\n")
	writeGoalCriteria(&b, goal.Criteria)
	b.WriteString(`
Rules:
- Run every criterion's check yourself (run tests, grep, lint, measure). You have no conversation history by design — evidence you did not produce in this turn does not count.
- Verification only: do not fix, write, or modify anything, and do not delegate.
- Report with exactly one CREW44_GOAL_VERIFY block — the opening tag alone on one line, a JSON body, the closing tag alone on one line. Example:

` + goalMarkerExample(`<CREW44_GOAL_VERIFY>
{"summary": "One sentence on the outcome.",
 "results": [
   {"id": "c1", "status": "pass", "detail": "20/20 green"},
   {"id": "c2", "status": "fail", "detail": "flaked on run 13 — composer.flow timeout"}
 ]}
</CREW44_GOAL_VERIFY>`) + `

- ` + goalMarkerPlainTextRule + `
- "status" is "pass" or "fail", with short evidence in "detail". Cover every criterion id; an uncovered criterion counts as unverified and holds the gate.
- A criterion you cannot check is a "fail" with the reason as detail.
- Never end your turn without the marker.`)
	return b.String()
}

func goalContextForParticipant(goal *model.GoalState) string {
	if goal.Phase == model.GoalPhaseScoping {
		return ""
	}
	var b strings.Builder
	b.WriteString("This chat is in Goal mode — the task stays open until every criterion below verifies.\n\n")
	fmt.Fprintf(&b, "Goal: %s\n", goal.Statement)
	b.WriteString("Criteria (the definition of done):\n")
	writeGoalCriteria(&b, goal.Criteria)
	b.WriteString("\nThe lead agent owns scoping and readiness, and an independent verifier runs the gate — do not emit goal markers. Complete your delegated task with the criteria in mind, then hand back.")
	return b.String()
}

func writeGoalCriteria(b *strings.Builder, criteria []model.GoalCriterion) {
	for _, criterion := range criteria {
		fmt.Fprintf(b, "- [%s] %s (id: %s", criterion.Status, criterion.Text, criterion.ID)
		if criterion.Verify != "" {
			fmt.Fprintf(b, ", verify: %s", criterion.Verify)
		}
		if criterion.Detail != "" {
			fmt.Fprintf(b, ", last result: %s", criterion.Detail)
		}
		b.WriteString(")\n")
	}
}
