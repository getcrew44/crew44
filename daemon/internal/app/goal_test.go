package app

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// goalEngine pops one scripted assistant reply per chat run, recording every
// prompt and the system prompt it ran under. Title-summarizer calls (which
// run in a parallel goroutine on the first user turn) are answered silently
// so they never consume a scripted reply.
type goalEngine struct {
	mu           sync.Mutex
	replies      []string
	prompts      []string
	instructions []string
	agents       []model.AgentConfig
	resumes      []string
	requests     []runtime.RunRequest
	onRun        func(call int) // optional hook, runs before the reply is emitted
	// onEmitted runs after the reply has been emitted but before Run returns
	// — i.e. mid-stream, in the window between the turn's last content and
	// the run goroutine's end-of-turn saves.
	onEmitted func(call int)
}

func (e *goalEngine) Run(ctx context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	if strings.HasPrefix(request.Prompt, runtime.MockChatTitleSummarySentinel) {
		return runtime.RunResult{}, nil
	}
	e.mu.Lock()
	call := len(e.prompts)
	e.prompts = append(e.prompts, request.Prompt)
	e.instructions = append(e.instructions, request.Agent.Instruction)
	e.agents = append(e.agents, request.Agent)
	e.resumes = append(e.resumes, request.ResumeSessionID)
	e.requests = append(e.requests, request)
	var reply string
	if len(e.replies) > 0 {
		reply = e.replies[0]
		e.replies = e.replies[1:]
	} else {
		reply = "no scripted reply left"
	}
	hook := e.onRun
	emittedHook := e.onEmitted
	e.mu.Unlock()
	if hook != nil {
		hook(call)
	}
	if ctx.Err() != nil {
		return runtime.RunResult{}, ctx.Err()
	}
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: reply,
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	if emittedHook != nil {
		emittedHook(call)
	}
	return runtime.RunResult{SessionID: "goal-session"}, nil
}

func (e *goalEngine) promptCount() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return len(e.prompts)
}

func (e *goalEngine) prompt(i int) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i >= len(e.prompts) {
		return ""
	}
	return e.prompts[i]
}

func (e *goalEngine) instruction(i int) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i >= len(e.instructions) {
		return ""
	}
	return e.instructions[i]
}

func (e *goalEngine) agent(i int) model.AgentConfig {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i >= len(e.agents) {
		return model.AgentConfig{}
	}
	return e.agents[i]
}

func (e *goalEngine) resume(i int) string {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i >= len(e.resumes) {
		return ""
	}
	return e.resumes[i]
}

func (e *goalEngine) request(i int) runtime.RunRequest {
	e.mu.Lock()
	defer e.mu.Unlock()
	if i >= len(e.requests) {
		return runtime.RunRequest{}
	}
	return e.requests[i]
}

func newGoalTestApp(t *testing.T, engine runtime.Engine) *App {
	t.Helper()
	root := t.TempDir()
	a, err := New(Config{
		StateDir:       filepath.Join(root, ".crew44"),
		RuntimeScanDir: filepath.Join(root, "runtime-manifests"),
		Scanner: runtime.StaticScanner{Records: []model.RuntimeRecord{{
			ID:         "runtime-mock",
			Provider:   "mock",
			Name:       "Mock Runtime",
			Status:     model.RuntimeStatusAvailable,
			BinaryPath: "builtin://mock",
			Version:    "test",
		}}},
		Engine: engine,
	})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func newGoalChat(t *testing.T, a *App, agentID string) model.ChatRecord {
	t.Helper()
	project, err := a.CreateProject("Goal Project", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	chat, err := a.CreateChatWithOptions(project.ID, "fix the flaky tests", agentID, ChatCreateOptions{GoalMode: true})
	if err != nil {
		t.Fatal(err)
	}
	return chat
}

// lockGoalState force-advances a goal chat into the running phase with the
// given criteria, skipping the clarify round — most gate tests start here.
func lockGoalState(t *testing.T, a *App, chatID string, criteria ...model.GoalCriterion) {
	t.Helper()
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	chat.Goal.Phase = model.GoalPhaseRunning
	chat.Goal.Statement = "Suite verifiably stable"
	chat.Goal.Criteria = criteria
	chat.Goal.LockedAt = now
	chat.Goal.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		t.Fatal(err)
	}
}

func waitForIdle(t *testing.T, a *App, chatID string) model.ChatRecord {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		chat, err := a.store.GetChat(chatID)
		if err != nil {
			t.Fatal(err)
		}
		if chat.Stream.Status != "streaming" {
			return chat
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("chat never went idle")
	return model.ChatRecord{}
}

// currentClarifySeq reads the chat's pending clarify round seq — AnswerGoal
// requires it so answers bind to the round they answer.
func currentClarifySeq(t *testing.T, a *App, chatID string) int64 {
	t.Helper()
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		t.Fatal(err)
	}
	if chat.Goal == nil {
		return 0
	}
	return chat.Goal.ClarifySeq
}

func goalEventsOfType(t *testing.T, a *App, chatID string, eventType model.EventType) []model.Event {
	t.Helper()
	events, err := a.store.ListEvents(chatID, 0)
	if err != nil {
		t.Fatal(err)
	}
	var out []model.Event
	for _, event := range events {
		if event.Type == eventType {
			out = append(out, event)
		}
	}
	return out
}

func goalErrorEvents(t *testing.T, a *App, chatID, code string) []model.Event {
	t.Helper()
	var out []model.Event
	for _, event := range goalEventsOfType(t, a, chatID, model.EventTypeError) {
		if event.Error != nil && event.Error.Code == code {
			out = append(out, event)
		}
	}
	return out
}

const goalReady = "<CREW44_GOAL_READY>\n" +
	"{\"summary\": \"Everything checks out.\"}\n" +
	"</CREW44_GOAL_READY>"

const goalVerifyAllPass = "<CREW44_GOAL_VERIFY>\n" +
	"{\"summary\": \"All green.\", \"results\": [\n" +
	"  {\"id\": \"c1\", \"status\": \"pass\", \"detail\": \"20/20 green\"},\n" +
	"  {\"id\": \"c2\", \"status\": \"pass\", \"detail\": \"clean\"}\n" +
	"]}\n" +
	"</CREW44_GOAL_VERIFY>"

const goalVerifyC1Fails = "<CREW44_GOAL_VERIFY>\n" +
	"{\"results\": [\n" +
	"  {\"id\": \"c1\", \"status\": \"fail\", \"detail\": \"flaked on run 13\"},\n" +
	"  {\"id\": \"c2\", \"status\": \"pass\", \"detail\": \"clean\"}\n" +
	"]}\n" +
	"</CREW44_GOAL_VERIFY>"

func twoGoalCriteria() []model.GoalCriterion {
	return []model.GoalCriterion{
		{ID: "c1", Text: "Green on 20 consecutive runs", Verify: "run_tests x20", Status: model.GoalCriterionPending},
		{ID: "c2", Text: "No .only left behind", Verify: "grep gate", Status: model.GoalCriterionPending},
	}
}

func TestCreateChatGoalMode(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	project, err := a.CreateProject("P", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}

	plain, err := a.CreateChatWithOptions(project.ID, "no goal", agentID, ChatCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if plain.Goal != nil {
		t.Fatal("plain chat should have nil Goal")
	}

	goal, err := a.CreateChatWithOptions(project.ID, "goal", agentID, ChatCreateOptions{GoalMode: true})
	if err != nil {
		t.Fatal(err)
	}
	if goal.Goal == nil {
		t.Fatal("goal chat should have Goal state")
	}
	if goal.Goal.Phase != model.GoalPhaseScoping {
		t.Fatalf("phase = %q, want scoping", goal.Goal.Phase)
	}
	if goal.Goal.AttemptCap != model.GoalDefaultAttemptCap {
		t.Fatalf("attempt cap = %d, want %d", goal.Goal.AttemptCap, model.GoalDefaultAttemptCap)
	}
}

func TestGoalClarifyMarkerStoresQuestions(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"Three things are ambiguous.\n" +
			"<CREW44_GOAL_CLARIFY>\n" +
			"{\"intro\": \"Before the crew starts.\", \"questions\": [\n" +
			"  {\"id\": \"q1\", \"q\": \"Which tests?\", \"type\": \"chips\", \"options\": [\"onboarding only\", \"whole suite\"], \"rec\": 0},\n" +
			"  {\"id\": \"q2\", \"q\": \"Off-limits?\", \"type\": \"text\"}\n" +
			"]}\n" +
			"</CREW44_GOAL_CLARIFY>",
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)

	if _, err := a.PostMessage(chat.ID, "fix the flaky onboarding tests", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseScoping {
		t.Fatalf("phase = %q, want scoping", got.Goal.Phase)
	}
	if len(got.Goal.Questions) != 2 {
		t.Fatalf("questions = %d, want 2", len(got.Goal.Questions))
	}
	clarifyEvents := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalClarify)
	if len(clarifyEvents) != 1 {
		t.Fatalf("clarify events = %d, want 1", len(clarifyEvents))
	}
	if got.Goal.ClarifySeq != clarifyEvents[0].Seq {
		t.Fatalf("ClarifySeq = %d, event seq = %d", got.Goal.ClarifySeq, clarifyEvents[0].Seq)
	}
	if clarifyEvents[0].GoalClarify == nil || clarifyEvents[0].GoalClarify.Intro != "Before the crew starts." {
		t.Fatalf("clarify payload = %+v", clarifyEvents[0].GoalClarify)
	}
	// The marker is stripped from the persisted assistant message.
	for _, event := range goalEventsOfType(t, a, chat.ID, model.EventTypeMessage) {
		if strings.Contains(event.Message.Content, "CREW44_GOAL_CLARIFY") {
			t.Fatalf("marker leaked into message: %q", event.Message.Content)
		}
	}
	// The system prompt carried the scoping instructions.
	if !strings.Contains(engine.instruction(0), "Goal Mode") || !strings.Contains(engine.instruction(0), "CREW44_GOAL_CLARIFY") {
		t.Fatal("lead scoping system prompt missing Goal Mode clarify instructions")
	}
}

func TestAnswerGoalValidation(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"<CREW44_GOAL_CLARIFY>\n" +
			"{\"questions\": [\n" +
			"  {\"id\": \"q1\", \"q\": \"Which tests?\", \"type\": \"chips\", \"options\": [\"a\", \"b\"]},\n" +
			"  {\"id\": \"q2\", \"q\": \"Off-limits?\", \"type\": \"text\"}\n" +
			"]}\n" +
			"</CREW44_GOAL_CLARIFY>",
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	waitForIdle(t, a, chat.ID)

	option0 := 0
	option9 := 9
	cases := []struct {
		name    string
		answers []GoalAnswerInput
		wantErr error
	}{
		{"unknown question", []GoalAnswerInput{{QuestionID: "nope", Option: &option0}}, ErrBadRequest},
		{"option out of range", []GoalAnswerInput{{QuestionID: "q1", Option: &option9}}, ErrBadRequest},
		{"chips question missing option", []GoalAnswerInput{{QuestionID: "q1", Text: "prose"}}, ErrBadRequest},
		{"chips unanswered", []GoalAnswerInput{{QuestionID: "q2", Text: "nothing"}}, ErrBadRequest},
	}
	seq := currentClarifySeq(t, a, chat.ID)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := a.AnswerGoal(chat.ID, seq, tc.answers); !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
		})
	}

	// Wrong phase: a non-goal chat conflicts.
	project, err := a.CreateProject("P2", t.TempDir(), agentID)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := a.CreateChatWithOptions(project.ID, "plain", agentID, ChatCreateOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.AnswerGoal(plain.ID, 0, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("non-goal chat err = %v, want conflict", err)
	}
}

func TestAnswerGoalLocksGoal(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"<CREW44_GOAL_CLARIFY>\n" +
			"{\"questions\": [\n" +
			"  {\"id\": \"q1\", \"q\": \"Which tests?\", \"type\": \"chips\", \"options\": [\"onboarding only\", \"whole suite\"]},\n" +
			"  {\"id\": \"q2\", \"q\": \"Off-limits?\", \"type\": \"text\"}\n" +
			"]}\n" +
			"</CREW44_GOAL_CLARIFY>",
		"Locked.\n" +
			"<CREW44_GOAL_LOCK>\n" +
			"{\"statement\": \"Onboarding suite verifiably stable\", \"criteria\": [\n" +
			"  {\"id\": \"c1\", \"text\": \"Green on 20 runs\", \"verify\": \"run_tests x20\"},\n" +
			"  {\"text\": \"No .only left\", \"verify\": \"grep\"}\n" +
			"]}\n" +
			"</CREW44_GOAL_LOCK>",
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	waitForIdle(t, a, chat.ID)

	option0 := 0
	if _, err := a.AnswerGoal(chat.ID, currentClarifySeq(t, a, chat.ID), []GoalAnswerInput{
		{QuestionID: "q1", Option: &option0},
		{QuestionID: "q2", Text: "don't touch CI config"},
	}); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running", got.Goal.Phase)
	}
	if got.Goal.Statement != "Onboarding suite verifiably stable" {
		t.Fatalf("statement = %q", got.Goal.Statement)
	}
	if len(got.Goal.Criteria) != 2 {
		t.Fatalf("criteria = %d, want 2", len(got.Goal.Criteria))
	}
	for _, criterion := range got.Goal.Criteria {
		if criterion.Status != model.GoalCriterionPending {
			t.Fatalf("criterion %q status = %q, want pending", criterion.ID, criterion.Status)
		}
	}
	if len(got.Goal.Questions) != 0 {
		t.Fatal("questions should clear on lock")
	}
	if got.Goal.Answers["q1"] != "onboarding only" || got.Goal.Answers["q2"] != "don't touch CI config" {
		t.Fatalf("answers = %+v", got.Goal.Answers)
	}
	if len(goalEventsOfType(t, a, chat.ID, model.EventTypeGoalLock)) != 1 {
		t.Fatal("want one goal_lock event")
	}
	// The lock turn was internal: the answers prompt reached the engine but
	// never landed as a user message event.
	if !strings.Contains(engine.prompt(1), "Goal scoping answers") {
		t.Fatalf("lock prompt = %q", engine.prompt(1))
	}
	for _, event := range goalEventsOfType(t, a, chat.ID, model.EventTypeMessage) {
		if event.Message.Role == model.MessageRoleUser && strings.Contains(event.Message.Content, "Goal scoping answers") {
			t.Fatal("answers prompt leaked as a user message event")
		}
	}
}

func TestGoalLockKicksOffWorkTurn(t *testing.T) {
	engine := &goalEngine{replies: []string{
		// Turn 1 (scoping): the lead locks the goal and the turn ends.
		"Locked.\n" +
			"<CREW44_GOAL_LOCK>\n" +
			"{\"statement\": \"Suite verifiably stable\", \"criteria\": [\n" +
			"  {\"id\": \"c1\", \"text\": \"Green on 20 consecutive runs\", \"verify\": \"run_tests x20\"},\n" +
			"  {\"id\": \"c2\", \"text\": \"No .only left behind\", \"verify\": \"grep gate\"}\n" +
			"]}\n" +
			"</CREW44_GOAL_LOCK>",
		// Turn 2 (daemon kickoff): the crew works and declares ready.
		"done\n" + goalReady,
		// Turn 3 (isolated verifier): the gate opens.
		goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)

	if _, err := a.PostMessage(chat.ID, "plan the release", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	// The lock must not strand the run idle: the daemon starts the first
	// work turn itself, and the ready declaration hands off to the verifier.
	if engine.promptCount() != 3 {
		t.Fatalf("engine runs = %d, want 3 (lock turn + kickoff turn + verifier turn)", engine.promptCount())
	}
	if !strings.Contains(engine.prompt(1), "goal is locked") || !strings.Contains(engine.prompt(1), "Green on 20 consecutive runs") {
		t.Fatalf("kickoff prompt = %q", engine.prompt(1))
	}
	// The kickoff turn ran under the running-phase system prompt: ready
	// protocol only, never the verify marker.
	if !strings.Contains(engine.instruction(1), "CREW44_GOAL_READY") {
		t.Fatal("kickoff turn missing running-phase ready instructions")
	}
	if !strings.Contains(engine.prompt(2), "Run the verification gate now") {
		t.Fatalf("verifier prompt = %q", engine.prompt(2))
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
}

func TestGoalVerifyFailAutoContinuesUntilPass(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"attempt one\n" + goalReady, // lead declares ready
		goalVerifyC1Fails,           // verifier holds the gate
		"fixed it\n" + goalReady,    // lead continuation declares ready again
		goalVerifyAllPass,           // verifier opens the gate
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "get it green", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
	if got.Goal.Attempt != 2 {
		t.Fatalf("attempt = %d, want 2", got.Goal.Attempt)
	}
	if engine.promptCount() != 4 {
		t.Fatalf("engine runs = %d, want 4 (lead, verifier, lead, verifier)", engine.promptCount())
	}
	verifyEvents := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalVerify)
	if len(verifyEvents) != 2 {
		t.Fatalf("verify events = %d, want 2", len(verifyEvents))
	}
	if verifyEvents[0].GoalVerify.Overall != "failed" || verifyEvents[1].GoalVerify.Overall != "passed" {
		t.Fatalf("overall = %q, %q", verifyEvents[0].GoalVerify.Overall, verifyEvents[1].GoalVerify.Overall)
	}
	if verifyEvents[0].GoalVerify.Attempt != 1 || verifyEvents[1].GoalVerify.Attempt != 2 {
		t.Fatalf("attempts = %d, %d", verifyEvents[0].GoalVerify.Attempt, verifyEvents[1].GoalVerify.Attempt)
	}
	// Verification is attributed to the anonymous verifier, never the lead.
	for _, event := range verifyEvents {
		if event.ActorAgentID != model.GoalVerifierAgentID || event.ActorAgentName != model.GoalVerifierAgentName {
			t.Fatalf("verify actor = %q/%q, want verifier", event.ActorAgentID, event.ActorAgentName)
		}
	}
	doneEvents := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalDone)
	if len(doneEvents) != 1 || doneEvents[0].GoalDone.Attempts != 2 || doneEvents[0].GoalDone.CriteriaTotal != 2 {
		t.Fatalf("done events = %+v", doneEvents)
	}
	// The continuation turn carried the held-gate prompt naming the failure.
	if !strings.Contains(engine.prompt(2), "Goal gate held") || !strings.Contains(engine.prompt(2), "Green on 20 consecutive runs") {
		t.Fatalf("continuation prompt = %q", engine.prompt(2))
	}
	// And the running-phase system prompt carried the criteria and the ready
	// protocol — not the verify marker, which belongs to the verifier.
	if !strings.Contains(engine.instruction(0), "CREW44_GOAL_READY") || !strings.Contains(engine.instruction(0), "Green on 20 consecutive runs") {
		t.Fatal("running system prompt missing ready instructions or criteria")
	}
	if strings.Contains(engine.instruction(0), "never emit CREW44_GOAL_VERIFY") == false {
		t.Fatal("running system prompt must forbid the verify marker")
	}
}

func TestGoalVerifierTurnIsIsolatedAndAnonymous(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"all set\n" + goalReady,
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

	if engine.promptCount() != 2 {
		t.Fatalf("engine runs = %d, want 2 (lead + verifier)", engine.promptCount())
	}
	verifier := engine.agent(1)
	if verifier.ID != model.GoalVerifierAgentID || verifier.Name != model.GoalVerifierAgentName {
		t.Fatalf("verifier agent = %q/%q, want anonymous verifier", verifier.ID, verifier.Name)
	}
	// Fresh session: the verifier never resumes the crew's runtime session.
	if engine.resume(1) != "" {
		t.Fatalf("verifier resume session = %q, want empty", engine.resume(1))
	}
	instruction := engine.instruction(1)
	if !strings.Contains(instruction, "Goal Verification") || !strings.Contains(instruction, "CREW44_GOAL_VERIFY") {
		t.Fatal("verifier system prompt missing verification instructions")
	}
	if strings.Contains(instruction, "Handover Output Protocol") || strings.Contains(instruction, "Available Agents For Handover") {
		t.Fatal("verifier system prompt must not carry handover sections")
	}
	if strings.Contains(instruction, "Conversation Summary") {
		t.Fatal("verifier system prompt must not reference the conversation summary")
	}
	// The verifier leaves no trace on chat-level agent state: the lead's
	// session stays resumable and the verifier never becomes a participant
	// or message target.
	if got.LastRuntimeSession.AgentID != agentID {
		t.Fatalf("last runtime session agent = %q, want lead", got.LastRuntimeSession.AgentID)
	}
	if got.CurrentAgentID != agentID {
		t.Fatalf("current agent = %q, want lead", got.CurrentAgentID)
	}
	for _, participant := range got.ParticipantAgentIDs {
		if participant == model.GoalVerifierAgentID {
			t.Fatal("verifier leaked into participant agent ids")
		}
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
}

func TestGoalAttemptCapStopsLoop(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"a\n" + goalReady,
		goalVerifyC1Fails,
		"b\n" + goalReady,
		goalVerifyC1Fails,
		"c\n" + goalReady,
		goalVerifyC1Fails,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)
	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.AttemptCap = 2
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	// Initial turn + two auto-continues, each followed by a verifier turn,
	// then the cap holds.
	if engine.promptCount() != 6 {
		t.Fatalf("engine runs = %d, want 6", engine.promptCount())
	}
	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running (gate still held)", got.Goal.Phase)
	}
	if got.Goal.Attempt != 3 {
		t.Fatalf("attempt = %d, want 3", got.Goal.Attempt)
	}
	capEvents := goalErrorEvents(t, a, chat.ID, "goal_attempt_cap")
	if len(capEvents) != 1 {
		t.Fatalf("goal_attempt_cap events = %d, want 1", len(capEvents))
	}
	if got.Stream.Status != "idle" {
		t.Fatalf("stream = %q, want idle", got.Stream.Status)
	}

	// A fresh user message re-arms the budget.
	engine.mu.Lock()
	engine.replies = append(engine.replies, "d\n"+goalReady, goalVerifyAllPass)
	engine.mu.Unlock()
	if _, err := a.PostMessage(chat.ID, "keep going", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got = waitForIdle(t, a, chat.ID)
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase after re-arm = %q, want awaiting_signoff", got.Goal.Phase)
	}
}

const goalVerifyPartial = "partial\n<CREW44_GOAL_VERIFY>\n{\"results\": [{\"id\": \"c1\", \"status\": \"pass\"}]}\n</CREW44_GOAL_VERIFY>"

func TestGoalVerifyIncompleteHoldsGate(t *testing.T) {
	engine := &goalEngine{replies: []string{
		// The verifier covers only c1; c2 is left unverified — the gate must
		// hold even though every reported result passed.
		"ready\n" + goalReady,
		goalVerifyPartial,
		"ready again\n" + goalReady,
		goalVerifyPartial,
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
		t.Fatalf("phase = %q, want running", got.Goal.Phase)
	}
	var c1, c2 model.GoalCriterion
	for _, criterion := range got.Goal.Criteria {
		switch criterion.ID {
		case "c1":
			c1 = criterion
		case "c2":
			c2 = criterion
		}
	}
	if c1.Status != model.GoalCriterionVerified {
		t.Fatalf("c1 status = %q, want verified", c1.Status)
	}
	if c2.Status != model.GoalCriterionPending {
		t.Fatalf("c2 status = %q, want pending", c2.Status)
	}
	verifyEvents := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalVerify)
	if len(verifyEvents) == 0 || verifyEvents[0].GoalVerify.Overall != "failed" {
		t.Fatalf("verify events = %+v", verifyEvents)
	}
	for _, row := range verifyEvents[0].GoalVerify.Rows {
		if row.ID == "c2" && row.Status != "pending" {
			t.Fatalf("c2 row status = %q, want pending", row.Status)
		}
	}
}

func TestGoalMarkerFromNonLeadIgnored(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"specialist verify\n" + goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	leadID := firstAgentID(t, a)
	specialist, err := a.CreateAgent("Specialist", "test agent", "do specialist things", "runtime-mock", "")
	if err != nil {
		t.Fatal(err)
	}
	chat := newGoalChat(t, a, leadID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "go", specialist.ID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running (verify from non-lead ignored)", got.Goal.Phase)
	}
	if got.Goal.Attempt != 0 {
		t.Fatalf("attempt = %d, want 0", got.Goal.Attempt)
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_ignored")) != 1 {
		t.Fatal("want one goal_marker_ignored error event")
	}
	if len(goalEventsOfType(t, a, chat.ID, model.EventTypeGoalVerify)) != 0 {
		t.Fatal("non-lead verify must not produce a goal_verify event")
	}
	// Non-lead agents get the read-only goal context, not the marker protocol.
	instruction := engine.instruction(0)
	if !strings.Contains(instruction, "do not emit goal markers") {
		t.Fatal("participant system prompt missing read-only goal context")
	}
	if strings.Contains(instruction, "CREW44_GOAL_VERIFY") {
		t.Fatal("participant system prompt must not carry the verify protocol")
	}
}

func TestGoalWrongPhaseMarkerIgnored(t *testing.T) {
	engine := &goalEngine{replies: []string{
		// Verify during scoping: invalid.
		"premature\n" + goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseScoping {
		t.Fatalf("phase = %q, want scoping", got.Goal.Phase)
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_ignored")) != 1 {
		t.Fatal("want one goal_marker_ignored error event")
	}
}

func TestGoalMalformedMarkerGetsOneCorrectiveTurn(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"oops\n<CREW44_GOAL_READY>\n{not json\n</CREW44_GOAL_READY>",
		"fixed\n" + goalReady,
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

	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_invalid")) != 1 {
		t.Fatal("want one goal_marker_invalid error event")
	}
	if !strings.Contains(engine.prompt(1), "malformed") || !strings.Contains(engine.prompt(1), "CREW44_GOAL_READY") {
		t.Fatalf("corrective prompt = %q", engine.prompt(1))
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff after corrected ready + verify", got.Goal.Phase)
	}
}

func TestGoalMalformedMarkerTwiceStopsIdle(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"oops\n<CREW44_GOAL_READY>\n{not json\n</CREW44_GOAL_READY>",
		"oops again\n<CREW44_GOAL_READY>\n{still not json\n</CREW44_GOAL_READY>",
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if engine.promptCount() != 2 {
		t.Fatalf("engine runs = %d, want 2 (one corrective turn only)", engine.promptCount())
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_invalid")) != 2 {
		t.Fatal("want two goal_marker_invalid error events")
	}
	if got.Stream.Status != "idle" {
		t.Fatalf("stream = %q, want idle", got.Stream.Status)
	}
}

func TestGoalLeadVerifyMarkerIgnored(t *testing.T) {
	// The screenshot bug: the lead tries to run the gate itself. The marker
	// is ignored — verification belongs to the isolated verifier turn.
	engine := &goalEngine{replies: []string{
		"verified it myself\n" + goalVerifyAllPass,
	}}
	a := newGoalTestApp(t, engine)
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "go", agentID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running (lead verify ignored)", got.Goal.Phase)
	}
	if got.Goal.Attempt != 0 {
		t.Fatalf("attempt = %d, want 0", got.Goal.Attempt)
	}
	if len(goalEventsOfType(t, a, chat.ID, model.EventTypeGoalVerify)) != 0 {
		t.Fatal("lead verify must not produce a goal_verify event")
	}
	ignored := goalErrorEvents(t, a, chat.ID, "goal_marker_ignored")
	if len(ignored) != 1 || !strings.Contains(ignored[0].Error.Message, "CREW44_GOAL_READY") {
		t.Fatalf("ignored events = %+v, want one pointing at the ready protocol", ignored)
	}
	// A malformed lead verify is equally not the verifier's problem: same
	// ignore path, no corrective re-emit of a marker the lead doesn't own.
	engine.mu.Lock()
	engine.replies = append(engine.replies, "broken\n<CREW44_GOAL_VERIFY>\n{not json\n</CREW44_GOAL_VERIFY>")
	engine.mu.Unlock()
	if _, err := a.PostMessage(chat.ID, "try again", agentID, nil); err != nil {
		t.Fatal(err)
	}
	waitForIdle(t, a, chat.ID)
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_invalid")) != 0 {
		t.Fatal("malformed lead verify must not be treated as correctable")
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_ignored")) != 2 {
		t.Fatal("want two goal_marker_ignored error events")
	}
}

func TestGoalVerifierMalformedVerifyGetsOneCorrectiveTurn(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"done\n" + goalReady,
		"checks ran\n<CREW44_GOAL_VERIFY>\n{not json\n</CREW44_GOAL_VERIFY>",
		"fixed\n" + goalVerifyAllPass,
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
	if len(goalErrorEvents(t, a, chat.ID, "goal_marker_invalid")) != 1 {
		t.Fatal("want one goal_marker_invalid error event")
	}
	// The corrective turn goes back to the verifier, not the lead.
	if engine.agent(2).ID != model.GoalVerifierAgentID {
		t.Fatalf("corrective turn agent = %q, want verifier", engine.agent(2).ID)
	}
	if !strings.Contains(engine.prompt(2), "malformed") {
		t.Fatalf("corrective prompt = %q", engine.prompt(2))
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
}

func TestGoalVerifierNoMarkerRetriesThenStops(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"done\n" + goalReady,
		"ran the checks, forgot to report",
		"still no marker",
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
	if engine.agent(2).ID != model.GoalVerifierAgentID {
		t.Fatalf("retry turn agent = %q, want verifier", engine.agent(2).ID)
	}
	if len(goalErrorEvents(t, a, chat.ID, "goal_verify_missing")) != 1 {
		t.Fatal("want one goal_verify_missing error event")
	}
	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running (gate never ran)", got.Goal.Phase)
	}
	if got.Stream.Status != "idle" {
		t.Fatalf("stream = %q, want idle", got.Stream.Status)
	}
}

func TestGoalPendingSteerSuppressesAutoContinue(t *testing.T) {
	steerQueued := make(chan struct{})
	engine := &goalEngine{replies: []string{
		"attempt\n" + goalReady,
		"steered reply",
	}}
	engine.onRun = func(call int) {
		if call == 0 {
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
	// Queue (but do not deliver) a steer while the first turn is streaming.
	if _, err := a.InterruptMessage(chat.ID, "change of direction", nil); err != nil {
		t.Fatal(err)
	}
	close(steerQueued)
	got := waitForIdle(t, a, chat.ID)

	// The ready declaration must not start a verifier turn past the queued
	// steer: the steer restart consumes it instead.
	for i := 0; i < engine.promptCount(); i++ {
		if strings.Contains(engine.prompt(i), "Run the verification gate now") {
			t.Fatalf("verifier turn fired despite pending steer: %q", engine.prompt(i))
		}
	}
	if engine.promptCount() != 2 {
		t.Fatalf("engine runs = %d, want 2", engine.promptCount())
	}
	if !strings.Contains(engine.prompt(1), "change of direction") {
		t.Fatalf("steer prompt = %q", engine.prompt(1))
	}
	if got.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running", got.Goal.Phase)
	}
}

func TestUpdateGoalCriteria(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green on 20 runs", Verify: "ci", Status: model.GoalCriterionVerified, Detail: "20/20"},
		model.GoalCriterion{ID: "c2", Text: "No .only left", Verify: "grep", Status: model.GoalCriterionFailed, Detail: "2 found"},
		model.GoalCriterion{ID: "c3", Text: "Suite under 90s", Verify: "timing", Status: model.GoalCriterionVerified, Detail: "74s"},
	)

	updated, err := a.UpdateGoalCriteria(chat.ID, nil, []GoalCriterionInput{
		{ID: "c1", Text: "Green on 20 runs"},                // unchanged: keeps verified
		{ID: "c2", Text: "No .only or .skip left anywhere"}, // text changed: resets
		{Text: "New criterion without id", Verify: "lead"},  // added: pending, gets an id
		// c3 removed.
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Goal.Criteria) != 3 {
		t.Fatalf("criteria = %d, want 3", len(updated.Goal.Criteria))
	}
	byID := map[string]model.GoalCriterion{}
	for _, criterion := range updated.Goal.Criteria {
		byID[criterion.ID] = criterion
	}
	if byID["c1"].Status != model.GoalCriterionVerified || byID["c1"].Detail != "20/20" {
		t.Fatalf("c1 = %+v, want status/detail preserved", byID["c1"])
	}
	if byID["c1"].Verify != "ci" {
		t.Fatalf("c1 verify = %q, want inherited", byID["c1"].Verify)
	}
	if byID["c2"].Status != model.GoalCriterionPending || byID["c2"].Detail != "" {
		t.Fatalf("c2 = %+v, want reset to pending", byID["c2"])
	}
	if _, ok := byID["c3"]; ok {
		t.Fatal("c3 should be removed")
	}
	for id, criterion := range byID {
		if id != "c1" && id != "c2" && criterion.Status != model.GoalCriterionPending {
			t.Fatalf("new criterion = %+v, want pending", criterion)
		}
	}

	// Statement update.
	statement := "A sharper goal"
	updated, err = a.UpdateGoalCriteria(chat.ID, &statement, []GoalCriterionInput{{ID: "c1", Text: "Green on 20 runs"}})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Goal.Statement != "A sharper goal" {
		t.Fatalf("statement = %q", updated.Goal.Statement)
	}

	// Empty list rejected.
	if _, err := a.UpdateGoalCriteria(chat.ID, nil, nil); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("empty list err = %v, want bad request", err)
	}
}

func TestUpdateGoalCriteriaPhaseRules(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)

	// Scoping: nothing locked yet, edits conflict.
	if _, err := a.UpdateGoalCriteria(chat.ID, nil, []GoalCriterionInput{{Text: "x"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("scoping err = %v, want conflict", err)
	}

	// awaiting_signoff: an edit that introduces a pending criterion re-arms
	// the gate back to running.
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green", Verify: "ci", Status: model.GoalCriterionVerified},
	)
	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseAwaitingSignoff
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}
	updated, err := a.UpdateGoalCriteria(chat.ID, nil, []GoalCriterionInput{
		{ID: "c1", Text: "Green"},
		{Text: "Also document the fix"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Goal.Phase != model.GoalPhaseRunning {
		t.Fatalf("phase = %q, want running (gate re-armed)", updated.Goal.Phase)
	}

	// done: closed goals are immutable.
	stored, err = a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseDone
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}
	if _, err := a.UpdateGoalCriteria(chat.ID, nil, []GoalCriterionInput{{Text: "x"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("done err = %v, want conflict", err)
	}
}

func TestSignoffGoalAccept(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	agentID := firstAgentID(t, a)
	chat := newGoalChat(t, a, agentID)
	lockGoalState(t, a, chat.ID,
		model.GoalCriterion{ID: "c1", Text: "Green", Verify: "ci", Status: model.GoalCriterionVerified},
	)

	// Wrong phase conflicts.
	if _, err := a.SignoffGoal(chat.ID, "accept", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("running-phase signoff err = %v, want conflict", err)
	}

	stored, err := a.store.GetChat(chat.ID)
	if err != nil {
		t.Fatal(err)
	}
	stored.Goal.Phase = model.GoalPhaseAwaitingSignoff
	if err := a.store.SaveChat(stored); err != nil {
		t.Fatal(err)
	}

	got, err := a.SignoffGoal(chat.ID, "accept", "")
	if err != nil {
		t.Fatal(err)
	}
	if got.Goal.Phase != model.GoalPhaseDone {
		t.Fatalf("phase = %q, want done", got.Goal.Phase)
	}
	if got.Status != "closed" {
		t.Fatalf("chat status = %q, want closed", got.Status)
	}
	if got.Goal.DoneAt.IsZero() {
		t.Fatal("DoneAt not set")
	}
	signoffs := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalSignoff)
	if len(signoffs) != 1 || signoffs[0].GoalSignoff.Action != "accept" {
		t.Fatalf("signoff events = %+v", signoffs)
	}

	// Unknown action rejected.
	if _, err := a.SignoffGoal(chat.ID, "shrug", ""); !errors.Is(err, ErrConflict) {
		// Phase is done now, so it conflicts before action validation; both
		// rejections are acceptable, but it must not succeed.
		if !errors.Is(err, ErrBadRequest) {
			t.Fatalf("unknown action err = %v", err)
		}
	}
}

func TestSignoffGoalSendBack(t *testing.T) {
	engine := &goalEngine{replies: []string{
		"rework done\n" + goalReady,
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

	// Notes are required.
	if _, err := a.SignoffGoal(chat.ID, "send_back", "  "); !errors.Is(err, ErrBadRequest) {
		t.Fatalf("blank notes err = %v, want bad request", err)
	}

	got, err := a.SignoffGoal(chat.ID, "send_back", "the spinner still flashes on slow networks")
	if err != nil {
		t.Fatal(err)
	}
	if got.Stream.Status != "streaming" {
		t.Fatalf("stream = %q, want streaming (rework turn started)", got.Stream.Status)
	}
	final := waitForIdle(t, a, chat.ID)

	signoffs := goalEventsOfType(t, a, chat.ID, model.EventTypeGoalSignoff)
	if len(signoffs) != 1 || signoffs[0].GoalSignoff.Action != "send_back" || signoffs[0].GoalSignoff.Notes == "" {
		t.Fatalf("signoff events = %+v", signoffs)
	}
	// The rework prompt carried the notes; the criteria were reset before
	// the rework verify ran (which then re-verified everything).
	if !strings.Contains(engine.prompt(0), "the spinner still flashes") {
		t.Fatalf("rework prompt = %q", engine.prompt(0))
	}
	if final.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff after rework verify", final.Goal.Phase)
	}
	if final.Goal.Attempt != 1 {
		t.Fatalf("attempt = %d, want 1", final.Goal.Attempt)
	}
}

func TestGoalHandoverWinsOverGateContinuation(t *testing.T) {
	a := newGoalTestApp(t, &goalEngine{})
	leadID := firstAgentID(t, a)
	specialist, err := a.CreateAgent("Specialist", "test agent", "specialist work", "runtime-mock", "")
	if err != nil {
		t.Fatal(err)
	}
	engine := &goalEngine{replies: []string{
		// Lead: declares ready AND hands over in the same message.
		"ready, delegating cleanup\n" + goalReady + "\n" +
			"<CREW44_AGENT_HANDOVER agent_id=\"" + specialist.ID + "\">fix the flake</CREW44_AGENT_HANDOVER>",
		// Specialist works, hands back nothing — turn just ends.
		"specialist done",
		// The verifier only runs after the handover chain unwinds; it holds
		// the gate.
		goalVerifyC1Fails,
		// Gate continuation returns to the lead, which declares ready again.
		"all green\n" + goalReady,
		// The verifier opens the gate.
		goalVerifyAllPass,
	}}
	// Swap the engine in (App was built with an empty one for CreateAgent).
	a.engine = engine

	chat := newGoalChat(t, a, leadID)
	lockGoalState(t, a, chat.ID, twoGoalCriteria()...)

	if _, err := a.PostMessage(chat.ID, "go", leadID, nil); err != nil {
		t.Fatal(err)
	}
	got := waitForIdle(t, a, chat.ID)

	if engine.promptCount() != 5 {
		t.Fatalf("engine runs = %d, want 5 (lead, specialist, verifier, lead continuation, verifier)", engine.promptCount())
	}
	// The handover advanced first; the verifier turn only fired after the
	// chain unwound, and the gate continuation targeted the lead.
	if !strings.Contains(engine.prompt(1), "handover") && !strings.Contains(engine.prompt(1), "Continue from the previous agent") {
		t.Fatalf("specialist prompt = %q", engine.prompt(1))
	}
	if engine.agent(2).ID != model.GoalVerifierAgentID {
		t.Fatalf("turn 3 agent = %q, want verifier", engine.agent(2).ID)
	}
	if !strings.Contains(engine.prompt(3), "Goal gate held") {
		t.Fatalf("continuation prompt = %q", engine.prompt(3))
	}
	if got.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		t.Fatalf("phase = %q, want awaiting_signoff", got.Goal.Phase)
	}
	if got.CurrentAgentID != leadID {
		t.Fatalf("current agent = %q, want lead", got.CurrentAgentID)
	}
}
