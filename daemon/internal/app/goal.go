package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
)

// Goal mode (docs/goal-0610.md): the lead agent scopes the goal with a
// CREW44_GOAL_CLARIFY round, locks criteria with CREW44_GOAL_LOCK, and the
// crew iterates until a CREW44_GOAL_VERIFY run passes every criterion. The
// daemon parses the markers, owns the phase machine, and auto-continues the
// run after a failed gate. Every code path here is gated on chat.Goal != nil.

// goalRunState tracks gate outcomes within one runChat invocation so the
// outer loop can decide whether to auto-continue after a turn ends. The
// auto-continue budget is per-run: any user action spawns a fresh runChat
// and re-arms it.
type goalRunState struct {
	gateHeld bool
	// lockApplied is set when this run locked the goal, so the daemon can
	// immediately start the first work turn instead of going idle — the lock
	// turn ran under the scoping prompt, which ends after the marker.
	lockApplied     bool
	failedSnapshot  []model.GoalCriterion
	autoContinues   int
	malformedKind   model.GoalMarkerKind
	malformedErr    string
	correctionsUsed int
}

func (a *App) publishChatMeta(chatID string) {
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindChatMeta})
}

func (a *App) appendGoalEvent(chatID string, event model.Event) (model.Event, error) {
	persisted, err := a.store.AppendEvent(chatID, event)
	if err != nil {
		return model.Event{}, err
	}
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: persisted})
	return persisted, nil
}

// appendGoalErrorEvent surfaces a goal protocol problem on the timeline
// without stopping the stream — unlike finishChatWithErrorPayload, the run
// keeps going (a malformed marker gets one corrective turn, an ignored
// marker is informational).
func (a *App) appendGoalErrorEvent(chatID, turnID, agentID, agentName, code, message string) {
	_, _ = a.appendGoalEvent(chatID, model.Event{
		Type:           model.EventTypeError,
		TS:             time.Now().UTC(),
		TurnID:         turnID,
		ActorAgentID:   agentID,
		ActorAgentName: agentName,
		Error: &model.ErrorPayload{
			Subtype:   "goal",
			Code:      code,
			Message:   message,
			AgentID:   agentID,
			AgentName: agentName,
		},
	})
}

// processGoalMarkers applies the goal markers extracted from one assistant
// message, in order. Marker validity rules: only the lead agent may emit
// goal markers, and each kind is only valid in the phase that expects it.
// Invalid markers are recorded as non-fatal error events; they never stop
// the run.
func (a *App) processGoalMarkers(chatID, turnID, agentID, agentName string, markers []model.GoalMarker, run *goalRunState) error {
	for _, marker := range markers {
		chat, err := a.store.GetChat(chatID)
		if err != nil {
			return err
		}
		if chat.Goal == nil {
			return nil
		}
		if marker.Err != nil {
			run.malformedKind = marker.Kind
			run.malformedErr = marker.Err.Error()
			a.appendGoalErrorEvent(chatID, turnID, agentID, agentName, "goal_marker_invalid", marker.Err.Error())
			continue
		}
		if agentID != chat.MainAgentID {
			a.appendGoalErrorEvent(chatID, turnID, agentID, agentName, "goal_marker_ignored",
				"Only the lead agent can emit goal markers; the marker was ignored.")
			continue
		}
		switch marker.Kind {
		case model.GoalMarkerClarify:
			if chat.Goal.Phase != model.GoalPhaseScoping {
				a.appendGoalErrorEvent(chatID, turnID, agentID, agentName, "goal_marker_ignored",
					"CREW44_GOAL_CLARIFY is only valid while the goal is being scoped; the marker was ignored.")
				continue
			}
			if err := a.applyGoalClarify(chat, turnID, agentID, agentName, marker.Clarify); err != nil {
				return err
			}
		case model.GoalMarkerLock:
			if chat.Goal.Phase != model.GoalPhaseScoping {
				a.appendGoalErrorEvent(chatID, turnID, agentID, agentName, "goal_marker_ignored",
					"CREW44_GOAL_LOCK is only valid while the goal is being scoped; the marker was ignored.")
				continue
			}
			if err := a.applyGoalLock(chat, turnID, agentID, agentName, marker.Lock); err != nil {
				return err
			}
			run.lockApplied = true
		case model.GoalMarkerVerify:
			if chat.Goal.Phase != model.GoalPhaseRunning {
				a.appendGoalErrorEvent(chatID, turnID, agentID, agentName, "goal_marker_ignored",
					"CREW44_GOAL_VERIFY is only valid after the goal is locked and before sign-off; the marker was ignored.")
				continue
			}
			if err := a.applyGoalVerify(chat, turnID, agentID, agentName, marker.Verify, run); err != nil {
				return err
			}
		}
	}
	return nil
}

func (a *App) applyGoalClarify(chat model.ChatRecord, turnID, agentID, agentName string, payload *model.GoalClarifyPayload) error {
	event, err := a.appendGoalEvent(chat.ID, model.Event{
		Type:           model.EventTypeGoalClarify,
		TS:             time.Now().UTC(),
		TurnID:         turnID,
		ActorAgentID:   agentID,
		ActorAgentName: agentName,
		GoalClarify:    payload,
	})
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	chat.Goal.Questions = payload.Questions
	// A fresh clarify round supersedes any earlier answers.
	chat.Goal.Answers = nil
	chat.Goal.ClarifySeq = event.Seq
	chat.Goal.UpdatedAt = now
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return err
	}
	a.publishChatMeta(chat.ID)
	return nil
}

func (a *App) applyGoalLock(chat model.ChatRecord, turnID, agentID, agentName string, payload *model.GoalLockPayload) error {
	now := time.Now().UTC()
	chat.Goal.Statement = payload.Statement
	chat.Goal.Criteria = payload.Criteria
	chat.Goal.Phase = model.GoalPhaseRunning
	chat.Goal.Questions = nil
	chat.Goal.ClarifySeq = 0
	chat.Goal.Attempt = 0
	chat.Goal.LockedAt = now
	chat.Goal.UpdatedAt = now
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return err
	}
	if _, err := a.appendGoalEvent(chat.ID, model.Event{
		Type:           model.EventTypeGoalLock,
		TS:             now,
		TurnID:         turnID,
		ActorAgentID:   agentID,
		ActorAgentName: agentName,
		GoalLock:       payload,
	}); err != nil {
		return err
	}
	a.publishChatMeta(chat.ID)
	return nil
}

func (a *App) applyGoalVerify(chat model.ChatRecord, turnID, agentID, agentName string, marker *model.GoalVerifyMarker, run *goalRunState) error {
	now := time.Now().UTC()
	byID := make(map[string]model.GoalVerifyResult, len(marker.Results))
	for _, result := range marker.Results {
		// Results referencing unknown criterion IDs are dropped below by
		// simply never being looked up.
		byID[result.ID] = result
	}

	chat.Goal.Attempt++
	rows := make([]model.GoalVerifyRow, 0, len(chat.Goal.Criteria))
	var unmet []model.GoalCriterion
	for i := range chat.Goal.Criteria {
		criterion := &chat.Goal.Criteria[i]
		result, covered := byID[criterion.ID]
		switch {
		case covered && result.Status == "pass":
			criterion.Status = model.GoalCriterionVerified
			criterion.Detail = result.Detail
		case covered:
			criterion.Status = model.GoalCriterionFailed
			criterion.Detail = result.Detail
		default:
			// A criterion the verify run did not cover resets to pending —
			// an incomplete verify never opens the gate.
			criterion.Status = model.GoalCriterionPending
			criterion.Detail = ""
		}
		rowStatus := "pending"
		if covered {
			rowStatus = result.Status
		}
		rows = append(rows, model.GoalVerifyRow{
			ID:     criterion.ID,
			Text:   criterion.Text,
			Verify: criterion.Verify,
			Status: rowStatus,
			Detail: criterion.Detail,
		})
		if criterion.Status != model.GoalCriterionVerified {
			unmet = append(unmet, *criterion)
		}
	}

	overall := "failed"
	outcome := strings.TrimSpace(marker.Summary)
	if len(unmet) == 0 {
		overall = "passed"
		if outcome == "" {
			outcome = fmt.Sprintf("All %d criteria verified. Goal gate is open.", len(chat.Goal.Criteria))
		}
		chat.Goal.Phase = model.GoalPhaseAwaitingSignoff
	} else if outcome == "" {
		outcome = fmt.Sprintf("Gate held — %d of %d criteria failed or unverified.", len(unmet), len(chat.Goal.Criteria))
	}
	chat.Goal.UpdatedAt = now
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return err
	}

	if _, err := a.appendGoalEvent(chat.ID, model.Event{
		Type:           model.EventTypeGoalVerify,
		TS:             now,
		TurnID:         turnID,
		ActorAgentID:   agentID,
		ActorAgentName: agentName,
		GoalVerify: &model.GoalVerifyPayload{
			Attempt: chat.Goal.Attempt,
			Overall: overall,
			Rows:    rows,
			Outcome: outcome,
		},
	}); err != nil {
		return err
	}

	if overall == "passed" {
		elapsed := int64(0)
		if !chat.Goal.LockedAt.IsZero() {
			elapsed = int64(now.Sub(chat.Goal.LockedAt).Seconds())
		}
		if _, err := a.appendGoalEvent(chat.ID, model.Event{
			Type:   model.EventTypeGoalDone,
			TS:     now,
			TurnID: turnID,
			GoalDone: &model.GoalDonePayload{
				Statement:      chat.Goal.Statement,
				CriteriaTotal:  len(chat.Goal.Criteria),
				Attempts:       chat.Goal.Attempt,
				ElapsedSeconds: elapsed,
			},
		}); err != nil {
			return err
		}
	} else {
		run.gateHeld = true
		run.failedSnapshot = unmet
	}
	a.publishChatMeta(chat.ID)
	return nil
}

// nextGoalTurnPrompt decides whether the run should continue with another
// daemon-initiated turn after the handover chain has fully unwound. A held
// gate wins over a malformed-marker correction; a pending steer, a cancelled
// context, or an exhausted budget stops the loop.
func (a *App) nextGoalTurnPrompt(ctx context.Context, controller *chatRunController, chatID, turnID, agentID, agentName string, run *goalRunState) (string, bool) {
	if run == nil || ctx.Err() != nil {
		return "", false
	}
	if !run.gateHeld && !run.lockApplied && run.malformedKind == "" {
		return "", false
	}
	chat, err := a.store.GetChat(chatID)
	if err != nil || chat.Goal == nil {
		return "", false
	}
	if a.hasPendingSteer(chatID, controller) {
		return "", false
	}

	if run.gateHeld {
		run.gateHeld = false
		attemptCap := chat.Goal.AttemptCap
		if attemptCap <= 0 {
			attemptCap = model.GoalDefaultAttemptCap
		}
		if run.autoContinues >= attemptCap {
			a.appendGoalErrorEvent(chatID, turnID, agentID, agentName, "goal_attempt_cap",
				fmt.Sprintf("Verification gate held after %d automatic attempts — waiting for your direction.", attemptCap))
			return "", false
		}
		run.autoContinues++
		return buildGoalContinuationPrompt(chat.Goal, run.failedSnapshot, run.autoContinues, attemptCap), true
	}

	if run.lockApplied {
		run.lockApplied = false
		// Lock can only happen once per scoping round, so this kickoff turn
		// doesn't count against the auto-continue budget.
		if chat.Goal.Phase != model.GoalPhaseRunning {
			return "", false
		}
		return buildGoalKickoffPrompt(chat.Goal), true
	}

	kind := run.malformedKind
	errMsg := run.malformedErr
	run.malformedKind = ""
	run.malformedErr = ""
	if run.correctionsUsed >= 1 {
		return "", false
	}
	if chat.Goal.Phase != model.GoalPhaseScoping && chat.Goal.Phase != model.GoalPhaseRunning {
		return "", false
	}
	run.correctionsUsed++
	return buildGoalCorrectionPrompt(kind, errMsg), true
}

func goalMarkerTag(kind model.GoalMarkerKind) string {
	switch kind {
	case model.GoalMarkerClarify:
		return "CREW44_GOAL_CLARIFY"
	case model.GoalMarkerLock:
		return "CREW44_GOAL_LOCK"
	default:
		return "CREW44_GOAL_VERIFY"
	}
}

func buildGoalContinuationPrompt(goal *model.GoalState, unmet []model.GoalCriterion, attempt, attemptCap int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Goal gate held — verification attempt %d failed.\n\n", goal.Attempt)
	b.WriteString("Failed or unverified criteria:\n")
	for _, criterion := range unmet {
		b.WriteString("- ")
		b.WriteString(criterion.Text)
		if strings.TrimSpace(criterion.Detail) != "" {
			b.WriteString(" — ")
			b.WriteString(criterion.Detail)
		}
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "\nContinue working toward the goal. Fix the failures — hand over to another agent if one fits better — then run every criterion's check again and report with the CREW44_GOAL_VERIFY marker. This is auto-continuation %d of %d; if the gate cannot be opened, explain what is blocking.", attempt, attemptCap)
	return b.String()
}

func buildGoalKickoffPrompt(goal *model.GoalState) string {
	var b strings.Builder
	b.WriteString("The goal is locked and the verification gate is armed. Begin working toward it now — do not wait for further input.\n\n")
	fmt.Fprintf(&b, "Goal: %s\n", goal.Statement)
	b.WriteString("Criteria:\n")
	for _, criterion := range goal.Criteria {
		b.WriteString("- ")
		b.WriteString(criterion.Text)
		b.WriteString("\n")
	}
	b.WriteString("\nDelegate via handover when another agent fits better. When you believe every criterion is met, run each criterion's check yourself and report with the CREW44_GOAL_VERIFY marker.")
	return b.String()
}

func buildGoalCorrectionPrompt(kind model.GoalMarkerKind, errMsg string) string {
	return fmt.Sprintf("Your %s marker was malformed: %s\nRe-emit it as a single block — the opening tag alone on one line, a valid JSON body, and the closing tag alone on one line.", goalMarkerTag(kind), errMsg)
}

func buildGoalAnswersPrompt(questions []model.GoalClarifyQuestion, answers map[string]string) string {
	var b strings.Builder
	b.WriteString("Goal scoping answers:\n")
	for _, question := range questions {
		answer := answers[question.ID]
		if answer == "" {
			answer = "(no answer)"
		}
		fmt.Fprintf(&b, "- %s → %s\n", question.Q, answer)
	}
	b.WriteString("\nLock the goal now: restate the goal as one statement and the final criteria using the CREW44_GOAL_LOCK marker. Every criterion must be objectively checkable with your own tools.")
	return b.String()
}

func buildGoalSendBackPrompt(notes string) string {
	return "The user reviewed the result and sent it back with notes:\n\n" + notes +
		"\n\nThe goal gate is re-armed and all criteria reset to pending. Address the notes, then run every criterion's check again and report with the CREW44_GOAL_VERIFY marker."
}

// ── user-facing goal RPC methods ─────────────────────────────────────────

type GoalAnswerInput struct {
	QuestionID string `json:"question_id"`
	Option     *int   `json:"option,omitempty"`
	Text       string `json:"text,omitempty"`
}

type GoalCriterionInput struct {
	ID     string `json:"id,omitempty"`
	Text   string `json:"text"`
	Verify string `json:"verify,omitempty"`
}

// AnswerGoal resolves the user's structured answers to the pending clarify
// round, persists them on the goal state (the clarify event itself is
// immutable — clients learn "answered" from chat.goal), and starts an
// internal lead-agent turn instructing it to lock the goal.
func (a *App) AnswerGoal(chatID string, answers []GoalAnswerInput) (model.ChatRecord, error) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStream(chat)
	if chat.Goal == nil || chat.Goal.Phase != model.GoalPhaseScoping || len(chat.Goal.Questions) == 0 {
		return model.ChatRecord{}, ErrConflict
	}
	if chat.Stream.Status == "streaming" {
		return model.ChatRecord{}, ErrConflict
	}

	questionByID := make(map[string]model.GoalClarifyQuestion, len(chat.Goal.Questions))
	for _, question := range chat.Goal.Questions {
		questionByID[question.ID] = question
	}
	resolved := make(map[string]string, len(answers))
	for _, answer := range answers {
		question, ok := questionByID[answer.QuestionID]
		if !ok {
			return model.ChatRecord{}, fmt.Errorf("unknown question %q: %w", answer.QuestionID, ErrBadRequest)
		}
		if question.Type == "chips" {
			if answer.Option == nil || *answer.Option < 0 || *answer.Option >= len(question.Options) {
				return model.ChatRecord{}, fmt.Errorf("question %q needs a valid option: %w", answer.QuestionID, ErrBadRequest)
			}
			resolved[question.ID] = question.Options[*answer.Option]
			continue
		}
		if text := strings.TrimSpace(answer.Text); text != "" {
			resolved[question.ID] = text
		}
	}
	for _, question := range chat.Goal.Questions {
		if question.Type == "chips" && resolved[question.ID] == "" {
			return model.ChatRecord{}, fmt.Errorf("question %q is unanswered: %w", question.ID, ErrBadRequest)
		}
	}

	now := time.Now().UTC()
	chat.Goal.Answers = resolved
	chat.Goal.UpdatedAt = now
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}
	a.publishChatMeta(chatID)

	prompt := buildGoalAnswersPrompt(chat.Goal.Questions, resolved)
	return a.startGoalTurn(chatID, chat.MainAgentID, prompt)
}

// UpdateGoalCriteria replaces the criteria list wholesale (the
// agents.skills.replace precedent). A criterion that keeps its ID and text
// keeps its status; anything changed, added, or re-identified resets to
// pending. Allowed mid-stream — the next prompt build and verify mapping
// pick up the new list.
func (a *App) UpdateGoalCriteria(chatID string, statement *string, inputs []GoalCriterionInput) (model.ChatRecord, error) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	if chat.Goal == nil || chat.Goal.Phase == model.GoalPhaseScoping || chat.Goal.Phase == model.GoalPhaseDone {
		return model.ChatRecord{}, ErrConflict
	}

	existing := make(map[string]model.GoalCriterion, len(chat.Goal.Criteria))
	for _, criterion := range chat.Goal.Criteria {
		existing[criterion.ID] = criterion
	}
	seen := map[string]bool{}
	next := make([]model.GoalCriterion, 0, len(inputs))
	for _, input := range inputs {
		text := strings.TrimSpace(input.Text)
		if text == "" {
			continue
		}
		criterion := model.GoalCriterion{
			ID:     strings.TrimSpace(input.ID),
			Text:   text,
			Verify: strings.TrimSpace(input.Verify),
			Status: model.GoalCriterionPending,
		}
		if prev, ok := existing[criterion.ID]; ok && criterion.ID != "" && !seen[criterion.ID] {
			if prev.Text == criterion.Text {
				criterion.Status = prev.Status
				criterion.Detail = prev.Detail
			}
			if criterion.Verify == "" {
				criterion.Verify = prev.Verify
			}
		}
		if criterion.ID == "" || seen[criterion.ID] {
			criterion.ID = "c-" + shortID(id.New())
			criterion.Status = model.GoalCriterionPending
			criterion.Detail = ""
		}
		seen[criterion.ID] = true
		next = append(next, criterion)
	}
	if len(next) == 0 {
		return model.ChatRecord{}, ErrBadRequest
	}

	now := time.Now().UTC()
	chat.Goal.Criteria = next
	if statement != nil {
		if trimmed := strings.TrimSpace(*statement); trimmed != "" {
			chat.Goal.Statement = trimmed
		}
	}
	if chat.Goal.Phase == model.GoalPhaseAwaitingSignoff {
		for _, criterion := range next {
			if criterion.Status != model.GoalCriterionVerified {
				// The gate re-arms: the checklist changed under an open gate,
				// so the goal is no longer fully verified.
				chat.Goal.Phase = model.GoalPhaseRunning
				break
			}
		}
	}
	chat.Goal.UpdatedAt = now
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}
	a.publishChatMeta(chatID)
	return chat, nil
}

// SignoffGoal resolves an open gate. accept closes the task (soft status —
// the chat stays listed and readable). send_back resets every criterion to
// pending and starts an internal rework turn carrying the user's notes.
func (a *App) SignoffGoal(chatID, action, notes string) (model.ChatRecord, error) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStream(chat)
	if chat.Goal == nil || chat.Goal.Phase != model.GoalPhaseAwaitingSignoff {
		return model.ChatRecord{}, ErrConflict
	}
	if chat.Stream.Status == "streaming" {
		return model.ChatRecord{}, ErrConflict
	}

	now := time.Now().UTC()
	switch action {
	case "accept":
		chat.Goal.Phase = model.GoalPhaseDone
		chat.Goal.DoneAt = now
		chat.Goal.UpdatedAt = now
		chat.Status = "closed"
		chat.UpdatedAt = now
		if err := a.store.SaveChat(chat); err != nil {
			return model.ChatRecord{}, err
		}
		if _, err := a.appendGoalEvent(chatID, model.Event{
			Type:        model.EventTypeGoalSignoff,
			TS:          now,
			TurnID:      chat.ActiveTurnID,
			GoalSignoff: &model.GoalSignoffPayload{Action: "accept"},
		}); err != nil {
			return model.ChatRecord{}, err
		}
		a.publishChatMeta(chatID)
		return chat, nil
	case "send_back":
		notes = strings.TrimSpace(notes)
		if notes == "" {
			return model.ChatRecord{}, ErrBadRequest
		}
		for i := range chat.Goal.Criteria {
			chat.Goal.Criteria[i].Status = model.GoalCriterionPending
			chat.Goal.Criteria[i].Detail = ""
		}
		chat.Goal.Phase = model.GoalPhaseRunning
		chat.Goal.UpdatedAt = now
		chat.UpdatedAt = now
		if err := a.store.SaveChat(chat); err != nil {
			return model.ChatRecord{}, err
		}
		if _, err := a.appendGoalEvent(chatID, model.Event{
			Type:        model.EventTypeGoalSignoff,
			TS:          now,
			TurnID:      chat.ActiveTurnID,
			GoalSignoff: &model.GoalSignoffPayload{Action: "send_back", Notes: notes},
		}); err != nil {
			return model.ChatRecord{}, err
		}
		a.publishChatMeta(chatID)
		return a.startGoalTurn(chatID, chat.MainAgentID, buildGoalSendBackPrompt(notes))
	default:
		return model.ChatRecord{}, ErrBadRequest
	}
}

// startGoalTurn starts a new internal turn without appending a user message
// event — the prompt is daemon-composed (clarify answers, send-back rework),
// and the timeline already carries the corresponding goal event. Mirrors
// PostMessage's stream bookkeeping minus the user event and title
// summarizer.
func (a *App) startGoalTurn(chatID, targetAgentID, prompt string) (model.ChatRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStreamLocked(chat)
	if chat.Stream.Status == "streaming" {
		return model.ChatRecord{}, ErrConflict
	}
	agent, err := a.store.GetAgent(targetAgentID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	runtimeRecord, err := a.store.GetRuntime(agent.RuntimeID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	if runtimeRecord.Status == model.RuntimeStatusMissing {
		return model.ChatRecord{}, ErrConflict
	}
	if chat.LastRuntimeSession.AgentID != "" && chat.LastRuntimeSession.AgentID != targetAgentID {
		events, err := a.store.ListEvents(chatID, 0)
		if err == nil {
			_ = a.store.WriteSummary(chatID, model.BuildChatSummary(events))
		}
	}

	now := time.Now().UTC()
	turnID := id.New()
	chat.ActiveTurnID = turnID
	chat.CurrentAgentID = targetAgentID
	chat.UpdatedAt = now
	chat.Stream = model.ChatStreamState{
		Status:    "streaming",
		AgentID:   targetAgentID,
		StartedAt: now,
	}
	chat.PendingHandoverAgentID = ""
	chat.ParticipantAgentIDs = appendUnique(chat.ParticipantAgentIDs, targetAgentID)
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	controller := &chatRunController{cancel: cancel}
	a.runs[chatID] = controller
	go a.runChat(ctx, controller, chatID, targetAgentID, turnID, prompt)
	return chat, nil
}
