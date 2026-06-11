package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

const goalVerifyUnknownID = "<CREW44_GOAL_VERIFY>\n" +
	"{\"results\": [\n" +
	"  {\"id\": \"c1\", \"status\": \"pass\", \"detail\": \"20/20\"},\n" +
	"  {\"id\": \"zz-unknown\", \"status\": \"pass\", \"detail\": \"hallucinated\"}\n" +
	"]}\n" +
	"</CREW44_GOAL_VERIFY>"

func waitForStreaming(t *testing.T, a *App, chatID string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		chat, err := a.store.GetChat(chatID)
		if err != nil {
			t.Fatal(err)
		}
		if chat.Stream.Status == "streaming" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("chat never started streaming")
}

// AnswerGoal and SignoffGoal must conflict while a turn is streaming — the
// internal goal turn they start would otherwise race the live run.
func TestGoalRPCsConflictWhileStreaming(t *testing.T) {
	block := make(chan struct{})
	engine := &goalEngine{replies: []string{"working", "working"}}
	engine.onRun = func(call int) { <-block }
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)

	// AnswerGoal: scoping phase with a pending clarify round, mid-stream.
	answerChat := newGoalChat(t, a, agentID)
	stored, err := a.store.GetChat(answerChat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Questions = []model.GoalClarifyQuestion{{ID: "q1", Q: "Which tests?", Type: "text"}}
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PostMessage(answerChat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	waitForStreaming(t, a, answerChat.ID)
	if _, err := a.AnswerGoal(answerChat.ID, stored.Goal.ClarifySeq, []GoalAnswerInput{{QuestionID: "q1", Text: "all"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("AnswerGoal while streaming err = %v, want conflict", err)
	}

	// SignoffGoal: awaiting_signoff phase, mid-stream.
	signoffChat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, signoffChat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green", Verify: "ci", Status: model.GoalCriterionVerified},
	)
	stored, err = a.store.GetChat(signoffChat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseAwaitingSignoff
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PostMessage(signoffChat.ID, "looks good?", agentID, nil); err != nil {
		t.Fatal(err)
	}
	waitForStreaming(t, a, signoffChat.ID)
	if _, err := a.SignoffGoal(signoffChat.ID, "accept", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("SignoffGoal while streaming err = %v, want conflict", err)
	}

	close(block)
	waitForIdle(t, a, answerChat.ID)
	waitForIdle(t, a, signoffChat.ID)
}

// A fresh clarify round supersedes earlier answers: Answers reset, the new
// round's questions and seq take over, and the phase stays scoping.
func TestGoalSecondClarifyRoundSupersedesAnswers(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"<CREW44_GOAL_CLARIFY>\n" +
			"{\"questions\": [{\"id\": \"q1\", \"q\": \"Which tests?\", \"type\": \"text\"}]}\n" +
			"</CREW44_GOAL_CLARIFY>",
		// The lead asks again instead of locking.
		"<CREW44_GOAL_CLARIFY>\n" +
			"{\"questions\": [\n" +
			"  {\"id\": \"qa\", \"q\": \"Stable on which OS?\", \"type\": \"chips\", \"options\": [\"linux\", \"macos\"]},\n" +
			"  {\"id\": \"qb\", \"q\": \"Deadline?\", \"type\": \"text\"}\n" +
			"]}\n" +
			"</CREW44_GOAL_CLARIFY>",
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)

	if _, err := a.PostMessage(chat.ID, "fix the tests", agentID, nil); err != nil {
		t.Fatal(err)
	}
	waitForIdle(t, a, chat.ID)
	if _, err := a.AnswerGoal(chat.ID, currentClarifySeq(t, a, chat.ID), []GoalAnswerInput{{QuestionID: "q1", Text: "the whole suite"}}); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseScoping {
		t.Fatalf("phase = %q, want scoping", got.Goal.Phase)
	}
	if len(got.Goal.Answers) != 0 {
		t.Fatalf("answers = %+v, want cleared by the new round", got.Goal.Answers)
	}
	if len(got.Goal.Questions) != 2 || got.Goal.Questions[0].ID != "qa" {
		t.Fatalf("questions = %+v, want the second round's", got.Goal.Questions)
	}
	clarifyEvents := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalClarify)
	if len(clarifyEvents) != 2 {
		t.Fatalf("clarify events = %d, want 2", len(clarifyEvents))
	}
	if got.Goal.ClarifySeq != clarifyEvents[1].Seq {
		t.Fatalf("ClarifySeq = %d, want the second round's seq %d", got.Goal.ClarifySeq, clarifyEvents[1].Seq)
	}
}

// Verify results referencing unknown criterion ids are dropped; criteria the
// run never covered reset to pending and hold the gate.
func TestGoalVerifyUnknownCriterionIDsDropped(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"done\n" + goalReady,
		goalVerifyUnknownID,
		"again\n" + goalReady,
		goalVerifyUnknownID,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)
	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.AttemptCap = 1
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running (gate held)", got.Goal.Phase)
	}
	verifyEvents := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalVerify)
	if len(verifyEvents) == 0 {
		t.Fatal("want at least one verify event")
	}
	first := verifyEvents[0].GoalVerify
	if first.Overall != "failed" {
		t.Fatalf("overall = %q, want failed", first.Overall)
	}
	if len(first.Rows) != 2 {
		t.Fatalf("rows = %d, want 2 (unknown id dropped, never a row)", len(first.Rows))
	}
	for _, row := range first.Rows {
		switch row.ID {
		case "c1":
			if row.Status != "pass" {
				t.Fatalf("c1 row = %q, want pass", row.Status)
			}
		case "c2":
			if row.Status != "pending" {
				t.Fatalf("c2 row = %q, want pending (uncovered)", row.Status)
			}
		default:
			t.Fatalf("unexpected row id %q", row.ID)
		}
	}
}

// A steer queued during the isolated verifier turn restarts the run at the
// lead, never the verifier — the verifier is not a stored agent and must not
// become a message target.
func TestGoalSteerDuringVerifierTurnTargetsLead(t *testing.T) {
	steerQueued := make(chan struct{})
	engine := &goalEngine{replies: []string{
		"done\n" + goalReady,
		"checking the gate", // verifier turn output; steer interrupts it
		"steered reply",
	}}
	engine.onRun = func(call int) {
		if call == 1 {
			<-steerQueued
		}
	}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	// Wait for the verifier turn to be in flight, then queue the steer.
	deadline := time.Now().Add(5 * time.Second)
	for engine.promptCount() < 2 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if engine.promptCount() < 2 {
		t.Fatal("verifier turn never started")
	}
	if _, err := a.InterruptMessage(chat.ID, "change of direction", nil); err != nil {
		t.Fatal(err)
	}
	close(steerQueued)
	got := waitForIdle(t, a, chat.ID)

	if engine.promptCount() != 3 {
		t.Fatalf("engine runs = %d, want 3 (lead, verifier, steered lead)", engine.promptCount())
	}
	if engine.agent(2).ID == model.GoalVerifierAgentID {
		t.Fatal("steer restarted at the verifier; want the lead")
	}
	if engine.agent(2).ID != agentID {
		t.Fatalf("steered turn agent = %q, want lead %q", engine.agent(2).ID, agentID)
	}
	if !strings.Contains(engine.prompt(2), "change of direction") {
		t.Fatalf("steered prompt = %q", engine.prompt(2))
	}
	if got.CurrentAgentID != agentID {
		t.Fatalf("current agent = %q, want lead", got.CurrentAgentID)
	}
}

// Duplicate ids in a criteria update keep the first occurrence's identity;
// later duplicates are re-minted as new pending criteria.
func TestUpdateGoalCriteriaDuplicateInputIDs(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green", Verify: "ci", Status: model.GoalCriterionVerified, Detail: "20/20"},
	)

	updated, err := a.UpdateGoalCriteria(chat.ID, nil, []GoalCriterionInput{
		{ID: "c1", Text: "Green"},
		{ID: "c1", Text: "Imposter with the same id"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Goal.Criteria) != 2 {
		t.Fatalf("criteria = %d, want 2", len(updated.Goal.Criteria))
	}
	first, second := updated.Goal.Criteria[0], updated.Goal.Criteria[1]
	if first.ID != "c1" || first.Status != model.GoalCriterionVerified {
		t.Fatalf("first = %+v, want c1 verified preserved", first)
	}
	if second.ID == "c1" || second.ID == "" {
		t.Fatalf("second id = %q, want a fresh id", second.ID)
	}
	if second.Status != model.GoalCriterionPending || second.Detail != "" {
		t.Fatalf("second = %+v, want pending with no detail", second)
	}
}

// An edit that leaves every criterion verified does not re-arm an open gate.
func TestUpdateGoalCriteriaAllVerifiedKeepsSignoff(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green", Verify: "ci", Status: model.GoalCriterionVerified, Detail: "20/20"},
		model.GoalCriterion{ID: "c2", Text: "Clean", Verify: "grep", Status: model.GoalCriterionVerified, Detail: "clean"},
	)
	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseAwaitingSignoff
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}

	// Removing a criterion while the rest stay verified keeps the gate open.
	updated, err := a.UpdateGoalCriteria(chat.ID, nil, []GoalCriterionInput{
		{ID: "c1", Text: "Green"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff (all remaining verified)", updated.Goal.Phase)
	}
}

// A criteria edit committed mid-stream — after the turn's content (and its
// READY) has been processed but before the run goroutine's end-of-turn and
// goal-continuation saves — must survive those saves: they re-read under a.mu
// and write only run-owned fields, never a stale whole-record snapshot.
func TestUpdateGoalCriteriaMidStreamSurvivesRunEndSaves(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"work done\n" + goalReady,
		goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	statement := "Sharper goal"
	engine.onEmitted = func(call int) {
		if call != 0 {
			return
		}
		if _, err := a.UpdateGoalCriteria(chat.ID, &statement, []GoalCriterionInput{
			{ID: "c1", Text: "Green on 20 consecutive runs"},
			{ID: "c2", Text: "No .only or .skip left anywhere"},
		}); err != nil {
			t.Errorf("mid-stream UpdateGoalCriteria: %v", err)
		}
	}

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	// The edit survived every run-side save.
	if got.Goal.Statement != "Sharper goal" {
		t.Fatalf("statement = %q, want the mid-stream edit kept", got.Goal.Statement)
	}
	byID := map[string]model.GoalCriterion{}
	for _, criterion := range got.Goal.Criteria {
		byID[criterion.ID] = criterion
	}
	if byID["c2"].Text != "No .only or .skip left anywhere" {
		t.Fatalf("c2 = %+v, want the mid-stream text kept", byID["c2"])
	}
	// The verifier turn (built after the edit) saw the new checklist.
	if !strings.Contains(engine.instruction(1), "No .only or .skip left anywhere") {
		t.Fatal("verifier system prompt missing the mid-stream criteria edit")
	}
	// And the run still landed its own fields.
	if got.LastRuntimeSession.AgentID != agentID || got.LastRuntimeSession.SessionID != "goal-session" {
		t.Fatalf("last runtime session = %+v, want the lead's run session", got.LastRuntimeSession)
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
}

// A lead CREW44_GOAL_READY while the gate is open (awaiting_signoff) re-arms
// it: every criterion resets to pending, the phase drops back to running, and
// the verifier turn re-runs the whole gate — a pass re-opens it with a fresh
// goal_done.
func TestGoalReadyReArmsGateInAwaitingSignoff(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"tightened it further per your note\n" + goalReady,
		goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green on 20 consecutive runs", Verify: "ci", Status: model.GoalCriterionVerified, Detail: "20/20"},
		model.GoalCriterion{ID: "c2", Text: "No .only left behind", Verify: "grep", Status: model.GoalCriterionVerified, Detail: "clean"},
	)
	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseAwaitingSignoff
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}

	if _, err := a.PostMessage(chat.ID, "also make it work offline", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if engine.promptCount() != 2 {
		t.Fatalf("engine runs = %d, want 2 (lead + verifier)", engine.promptCount())
	}
	if !strings.Contains(engine.prompt(1), "Run the verification gate now") {
		t.Fatalf("verifier prompt = %q", engine.prompt(1))
	}
	// The re-arm reset the criteria before the verifier turn was built: its
	// system prompt shows pending rows with the old evidence cleared.
	if !strings.Contains(engine.instruction(1), "[pending] Green on 20 consecutive runs") {
		t.Fatal("verifier system prompt should show re-armed (pending) criteria")
	}
	if strings.Contains(engine.instruction(1), "last result: 20/20") {
		t.Fatal("stale verification evidence leaked into the re-armed verifier prompt")
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_ignored")) != 0 {
		t.Fatal("ready in awaiting_signoff must not be ignored")
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff (gate re-opened)", got.Goal.Phase)
	}
	if got.Goal.Attempt != 1 {
		t.Fatalf("attempt = %d, want 1", got.Goal.Attempt)
	}
	if len(goalEventsOfType(t, a, chat.ID, model.EventTypeGoalDone)) != 1 {
		t.Fatal("want a fresh goal_done from the re-run gate")
	}
}

// READY stays invalid in the scoping and done phases.
func TestGoalReadyRejectedInScopingAndDone(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"jumping the gun\n" + goalReady, // scoping chat
		"necromancy\n" + goalReady,      // done chat
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)

	scoping := newGoalChat(t, a, agentID)
	if _, err := a.PostMessage(scoping.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, scoping.ID)
	if got.Goal.Phase != model.GoalPhaseScoping {
		t.Fatalf("phase = %q, want scoping", got.Goal.Phase)
	}
	ignored := goalErrorEvents(t, a, scoping.ID, "goal_marker_ignored")
	if len(ignored) != 1 || !strings.Contains(ignored[0].Error.Message, "CREW44_GOAL_READY") {
		t.Fatalf("ignored events = %+v, want one for the scoping ready", ignored)
	}

	done := newGoalChat(t, a, agentID)
	lockGoalState(t, a, done.ID, twoGoalCriteria()...)
	stored, err := a.store.GetChat(done.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseDone
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}
	if _, err := a.PostMessage(done.ID, "one more thing", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got = waitForIdle(t, a, done.ID)
	if got.Goal.Phase != model.GoalPhaseDone {
		t.Fatalf("phase = %q, want done", got.Goal.Phase)
	}
	if len(goalErrorEvents(t, a, done.ID, "goal_marker_ignored")) != 1 {
		t.Fatal("want one goal_marker_ignored for the done-phase ready")
	}
	// No verifier turn fired for either chat.
	for i := 0; i < engine.promptCount(); i++ {
		if strings.Contains(engine.prompt(i), "Run the verification gate now") {
			t.Fatalf("verifier turn fired from an invalid-phase ready: %q", engine.prompt(i))
		}
	}
}

// A send_back whose rework turn fails to start must restore the prior state:
// phase back to awaiting_signoff, verification evidence intact, and a
// compensating event recording the rollback (the signoff event itself is
// immutable).
func TestSignoffGoalSendBackRevertsWhenReworkTurnFails(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green on 20 consecutive runs", Verify: "ci", Status: model.GoalCriterionVerified, Detail: "20/20"},
		model.GoalCriterion{ID: "c2", Text: "No .only left behind", Verify: "grep", Status: model.GoalCriterionVerified, Detail: "clean"},
	)
	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseAwaitingSignoff
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}
	// Break the rework turn: the lead's runtime goes missing, so
	// startGoalTurn conflicts after the send-back state was persisted.
	if err := a.store.SaveRuntimes([]model.RuntimeRecord{{
		ID:         "runtime-mock",
		Provider:   "mock",
		Name:       "Mock Runtime",
		Status:     model.RuntimeStatusMissing,
		BinaryPath: "builtin://mock",
		Version:    "test",
	}}); err != nil {
		t.Fatal(err)
	}

	if _, err := a.SignoffGoal(chat.ID, "send_back", "the spinner still flashes"); !errors.Is(err, ErrConflict) {
		t.Fatalf("send_back err = %v, want conflict from the failed turn start", err)
	}

	got, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff restored", got.Goal.Phase)
	}
	for _, criterion := range got.Goal.Criteria {
		if criterion.Status != model.GoalCriterionVerified || criterion.Detail == "" {
			t.Fatalf("criterion %+v, want verified status and evidence restored", criterion)
		}
	}
	if got.Stream.Status == "streaming" {
		t.Fatalf("stream = %q, want not streaming", got.Stream.Status)
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_signoff_reverted")) != 1 {
		t.Fatal("want one compensating goal_signoff_reverted event")
	}
	// The gate is still actionable: with the runtime back, accept works.
	if err := a.store.SaveRuntimes([]model.RuntimeRecord{{
		ID:         "runtime-mock",
		Provider:   "mock",
		Name:       "Mock Runtime",
		Status:     model.RuntimeStatusAvailable,
		BinaryPath: "builtin://mock",
		Version:    "test",
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.SignoffGoal(chat.ID, "accept", ""); err != nil {
		t.Fatalf("accept after revert: %v", err)
	}
}

// A valid READY alongside an unrelated malformed marker in the same lead
// message still starts the verifier — and the verifier's no-verdict retry
// prompt must not latch the lead's stale malformed error.
func TestGoalVerifierRetryPromptUnpollutedByLeadMalformedMarker(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"oops\n<CREW44_GOAL_CLARIFY>\n{not json\n</CREW44_GOAL_CLARIFY>\n" + goalReady,
		"ran the checks, forgot to report",
		goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if engine.promptCount() != 3 {
		t.Fatalf("engine runs = %d, want 3 (lead, verifier, verifier retry)", engine.promptCount())
	}
	if !strings.Contains(engine.prompt(1), "Run the verification gate now") {
		t.Fatalf("verifier prompt = %q, want the verifier turn despite the malformed clarify", engine.prompt(1))
	}
	if !strings.Contains(engine.prompt(2), "ended without a CREW44_GOAL_VERIFY block") {
		t.Fatalf("retry prompt = %q, want the no-marker message", engine.prompt(2))
	}
	if strings.Contains(engine.prompt(2), "CLARIFY") {
		t.Fatalf("retry prompt latched the lead's clarify error: %q", engine.prompt(2))
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_invalid")) != 1 {
		t.Fatal("want one goal_marker_invalid for the lead's malformed clarify")
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
}

// Cancelling the chat while the gate loop is auto-continuing must stop the
// loop cleanly — idle stream, no error events, goal state intact — and a
// fresh user message must re-arm it.
func TestGoalCancelMidGateLoopStopsAndReArms(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"attempt one\n" + goalReady, // lead declares ready
		goalVerifyC1Fails,           // verifier holds the gate
		"working on it",             // auto-continue turn — cancelled mid-flight
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)
	engine.onRun = func(call int) {
		if call == 2 {
			_ = a.CancelChat(chat.ID)
		}
	}

	if _, err := a.PostMessage(chat.ID, "get it green", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Stream.Status != "idle" {
		t.Fatalf("stream = %q, want idle", got.Stream.Status)
	}
	if engine.promptCount() != 3 {
		t.Fatalf("engine runs = %d, want 3 (lead, verifier, cancelled continuation)", engine.promptCount())
	}
	// The cancel must not be mistaken for a held gate or a missing verdict.
	if events := goalEventsOfType(t, a, chat.ID, model.EventTypeError); len(events) != 0 {
		t.Fatalf("error events after cancel = %d (%+v), want 0", len(events), events)
	}
	// Goal state survives the cancel: still running, one failed attempt on
	// the books, criteria statuses preserved.
	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running", got.Goal.Phase)
	}
	if got.Goal.Attempt != 1 {
		t.Fatalf("attempt = %d, want 1", got.Goal.Attempt)
	}

	// The loop is genuinely stopped — nothing restarts it on its own.
	time.Sleep(150 * time.Millisecond)
	if engine.promptCount() != 3 {
		t.Fatalf("engine runs after settle = %d, want 3 (loop must stay stopped)", engine.promptCount())
	}
	idle := waitForIdle(t, a, chat.ID)
	if idle.Stream.Status != "idle" {
		t.Fatalf("stream after settle = %q, want idle", idle.Stream.Status)
	}

	// A fresh user message re-arms the gate loop end to end.
	engine.mu.Lock()
	engine.replies = append(engine.replies, "fixed\n"+goalReady, goalVerifyAllPass)
	engine.onRun = nil
	engine.mu.Unlock()
	if _, err := a.PostMessage(chat.ID, "resume", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got = waitForIdle(t, a, chat.ID)
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase after re-arm = %q, want awaiting_signoff", got.Goal.Phase)
	}
	if got.Goal.Attempt != 2 {
		t.Fatalf("attempt after re-arm = %d, want 2", got.Goal.Attempt)
	}
}
