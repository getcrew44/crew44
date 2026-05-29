package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
	promptbuilder "github.com/getcrew44/crew44/daemon/internal/prompt"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

var errChatStoppedAfterError = errors.New("chat stopped after error event")

type chatRunController struct {
	cancel            context.CancelFunc
	pendingInterrupts []pendingInterrupt
}

type pendingInterrupt struct {
	id          string
	content     string
	attachments []model.MessageAttachment
	queuedAt    time.Time
	triggered   bool
}

func (a *App) PostMessage(chatID, content, targetAgentID string, attachments []model.MessageAttachment) (model.ChatRecord, error) {
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

	// Snapshot whether this is the chat's first user turn *before*
	// appending the new event. Used by runChat after the run finishes
	// to decide whether to dispatch the title summarizer.
	isFirstUserTurn := !chatHasPriorUserMessage(a, chatID)

	userEvent, err := a.store.AppendEvent(chatID, model.Event{
		Type:         model.EventTypeMessage,
		TS:           now,
		TurnID:       turnID,
		ActorAgentID: targetAgentID,
		Message: &model.MessagePayload{
			Role:        model.MessageRoleUser,
			Content:     content,
			Attachments: attachments,
		},
	})
	if err != nil {
		return model.ChatRecord{}, err
	}
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: userEvent})

	ctx, cancel := context.WithCancel(context.Background())
	controller := &chatRunController{cancel: cancel}
	a.runs[chatID] = controller
	go a.runChat(ctx, controller, chatID, targetAgentID, turnID, model.AppendAttachmentLinks(content, attachments))
	// Title summarization runs in parallel to the chat run, not after it,
	// so long-running first turns don't leave the chat showing the raw
	// first message as its title for the whole duration. The summarizer
	// has its own timeout (chatTitleSummaryTimeout) and respects an
	// existing manual rename, so it's safe to dispatch unconditionally on
	// the chat's first user turn.
	if isFirstUserTurn && strings.TrimSpace(content) != "" {
		go a.runChatTitleSummarizer(chatID, targetAgentID, content)
	}
	return chat, nil
}

// chatHasPriorUserMessage returns true when the chat's event log already
// holds at least one user-role message. Errors are treated as "yes" so we
// never re-run the title summarizer on an existing chat we couldn't read.
func chatHasPriorUserMessage(a *App, chatID string) bool {
	events, err := a.store.ListEvents(chatID, 0)
	if err != nil {
		return true
	}
	for _, ev := range events {
		if ev.Type == model.EventTypeMessage && ev.Message != nil && ev.Message.Role == model.MessageRoleUser {
			return true
		}
	}
	return false
}

func (a *App) InterruptMessage(chatID, content string, attachments []model.MessageAttachment) (model.ChatRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStreamLocked(chat)
	if chat.Stream.Status != "streaming" {
		return model.ChatRecord{}, ErrConflict
	}
	controller := a.runs[chatID]
	if controller == nil || controller.cancel == nil {
		return model.ChatRecord{}, ErrConflict
	}
	now := time.Now().UTC()
	pending := pendingInterrupt{
		id:          id.New(),
		content:     content,
		attachments: attachments,
		queuedAt:    now,
	}
	controller.pendingInterrupts = append(controller.pendingInterrupts, pending)
	chat.Stream.PendingSteers = pendingSteerStates(controller.pendingInterrupts)
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}
	return chat, nil
}

func (a *App) CancelPendingSteer(chatID, steerID string) (model.ChatRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStreamLocked(chat)
	controller := a.runs[chatID]
	if controller == nil {
		return model.ChatRecord{}, ErrConflict
	}
	next := controller.pendingInterrupts[:0]
	removed := false
	for _, pending := range controller.pendingInterrupts {
		if pending.id == steerID {
			if pending.triggered {
				return model.ChatRecord{}, ErrConflict
			}
			removed = true
			continue
		}
		next = append(next, pending)
	}
	if !removed {
		return model.ChatRecord{}, ErrConflict
	}
	controller.pendingInterrupts = next
	chat.Stream.PendingSteers = pendingSteerStates(controller.pendingInterrupts)
	chat.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}
	return chat, nil
}

func (a *App) DeliverPendingSteers(chatID string, steerIDs []string) (model.ChatRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStreamLocked(chat)
	if chat.Stream.Status != "streaming" {
		return model.ChatRecord{}, ErrConflict
	}
	controller := a.runs[chatID]
	if controller == nil || controller.cancel == nil {
		return model.ChatRecord{}, ErrConflict
	}
	if len(steerIDs) == 0 {
		return model.ChatRecord{}, ErrBadRequest
	}
	selected := make(map[string]bool, len(steerIDs))
	for _, steerID := range steerIDs {
		selected[steerID] = true
	}
	matched := 0
	for i := range controller.pendingInterrupts {
		if selected[controller.pendingInterrupts[i].id] {
			if controller.pendingInterrupts[i].triggered {
				return model.ChatRecord{}, ErrConflict
			}
			controller.pendingInterrupts[i].triggered = true
			matched++
		}
	}
	if matched != len(selected) {
		return model.ChatRecord{}, ErrConflict
	}
	chat.Stream.PendingSteers = pendingSteerStates(controller.pendingInterrupts)
	chat.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}
	cancel := controller.cancel
	if cancel != nil {
		cancel()
	}
	return chat, nil
}

func (a *App) runChat(ctx context.Context, controller *chatRunController, chatID, agentID, turnID, prompt string) {
	defer func() {
		a.mu.Lock()
		if a.runs[chatID] == controller {
			delete(a.runs, chatID)
		}
		a.mu.Unlock()
	}()

	currentAgentID := agentID
	currentTurnID := turnID
	currentPrompt := prompt
	currentHandoverNote := ""

	for {
		chat, err := a.store.GetChat(chatID)
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		agent, err := a.store.GetAgent(currentAgentID)
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		runtimeRecord, err := a.store.GetRuntime(agent.RuntimeID)
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		project, err := a.store.GetProject(chat.ProjectID)
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		agentSkills, err := a.resolveRunSkills(agent)
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		availableAgents, err := a.availableHandoverAgents()
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		runtimeAgent := agent
		runtimeAgent.Instruction = promptbuilder.BuildSystemPrompt(promptbuilder.SystemPromptInput{
			Agent:                   agent,
			Runtime:                 runtimeRecord,
			AvailableAgents:         availableAgents,
			Skills:                  promptSkills(agentSkills),
			SummaryPath:             a.store.SummaryPath(chatID),
			ChatSessionDir:          a.store.ChatSessionDir(chatID),
			HandoverNote:            currentHandoverNote,
			UserMemoryDir:           a.store.UserMemoryDir(),
			ProjectMemoryDir:        a.store.ProjectMemoryDir(project.ID),
			LegacyUserMemoryPath:    a.store.UserMemoryPath(),
			LegacyProjectMemoryPath: a.store.ProjectMemoryPath(project.ID),
		})

		resumeSessionID := ""
		if chat.LastRuntimeSession.AgentID == currentAgentID {
			resumeSessionID = chat.LastRuntimeSession.SessionID
		}

		var lastAssistant string
		var pendingHandoverAgent model.AgentConfig
		var pendingHandoverNote string
		pendingToolSeqs := map[string][]int64{}
		agentSourceDir := ""
		if agent.Source != nil {
			agentSourceDir = agent.Source.SourceDir
		}
		result, err := a.engine.Run(ctx, runtime.RunRequest{
			Runtime:         runtimeRecord,
			Agent:           runtimeAgent,
			AgentSkills:     agentSkills,
			Prompt:          currentPrompt,
			WorkDir:         chatWorkdir(chat, project),
			RuntimeEnvDir:   a.store.RuntimeEnvDir(currentAgentID),
			AgentSourceDir:  agentSourceDir,
			ResumeSessionID: resumeSessionID,
			// Only the main interactive turn gets the headless browser. Utility
			// calls like the title summarizer (chat_title.go) leave this off.
			EnableBrowserMCP: true,
		}, func(streamEvent runtime.StreamEvent) error {
			event := model.Event{
				Type:           streamEvent.Type,
				TS:             time.Now().UTC(),
				TurnID:         currentTurnID,
				ActorAgentID:   currentAgentID,
				ActorAgentName: agent.Name,
				Message:        streamEvent.Message,
				Thinking:       streamEvent.Thinking,
				ToolCall:       streamEvent.ToolCall,
				ToolCallResult: streamEvent.ToolCallResult,
				RuntimeSession: streamEvent.RuntimeSession,
			}
			if event.ToolCallResult != nil && event.ToolCallResult.CallID != "" {
				key := toolCallKey(currentAgentID, event.ToolCallResult.CallID)
				queue := pendingToolSeqs[key]
				if len(queue) > 0 {
					event.ToolCallResult.ToolCallSeq = queue[0]
					pendingToolSeqs[key] = queue[1:]
				}
			}
			if streamEvent.Message != nil && streamEvent.Message.Role == model.MessageRoleAssistant {
				cleaned, handoverTargets := model.ExtractAgentHandoverMarkers(streamEvent.Message.Content)
				lastAssistant = cleaned
				triggerSteer := cleaned != "" && a.hasPendingSteer(chatID, controller)
				if !triggerSteer {
					for _, handover := range handoverTargets {
						target, errorPayload := a.validateHandoverTarget(handover.AgentID, currentAgentID)
						if errorPayload != nil {
							a.finishChatWithErrorPayload(chatID, currentTurnID, currentAgentID, *errorPayload)
							return errChatStoppedAfterError
						}
						pendingHandoverAgent = target
						pendingHandoverNote = handover.Note
						latestChat, err := a.store.GetChat(chatID)
						if err != nil {
							return err
						}
						latestChat.PendingHandoverAgentID = target.ID
						latestChat.UpdatedAt = time.Now().UTC()
						if err := a.store.SaveChat(latestChat); err != nil {
							return err
						}
						if err := a.appendHandoverEvent(chatID, currentTurnID, currentAgentID, handoverSubtypeScheduled, target, handover.Note); err != nil {
							return err
						}
					}
				}
				if cleaned == "" {
					if len(handoverTargets) == 0 {
						a.finishChatWithErrorPayload(chatID, currentTurnID, currentAgentID, model.ErrorPayload{
							Subtype: "message",
							Code:    "empty_assistant_output",
							Message: "Assistant produced an empty message.",
						})
						return errChatStoppedAfterError
					}
					return nil
				}
				message := *streamEvent.Message
				message.Content = cleaned
				if triggerSteer {
					message.Interrupted = true
				}
				event.Message = &message
			}
			persisted, err := a.store.AppendEvent(chatID, event)
			if err != nil {
				return err
			}
			if persisted.ToolCall != nil && persisted.ToolCall.CallID != "" {
				key := toolCallKey(currentAgentID, persisted.ToolCall.CallID)
				pendingToolSeqs[key] = append(pendingToolSeqs[key], persisted.Seq)
			}
			if streamEvent.RuntimeSession != nil && streamEvent.RuntimeSession.SessionID != "" {
				a.updateLastRuntimeSession(chatID, currentAgentID, streamEvent.RuntimeSession.SessionID)
			}
			a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: persisted})
			if event.Message != nil && event.Message.Interrupted {
				a.triggerPendingSteer(chatID, controller)
			}
			return nil
		})
		if err != nil {
			if errors.Is(err, errChatStoppedAfterError) {
				return
			}
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				if delivered, remaining, ok := a.consumeTriggeredPendingSteer(chatID, controller); ok {
					if restartErr := a.restartAfterSteer(chatID, currentAgentID, delivered, remaining); restartErr != nil {
						a.finishChatWithError(chatID, restartErr.Error())
					}
					return
				}
				a.finishChatCanceled(chatID)
				return
			}
			a.finishChatWithRuntimeError(chatID, currentTurnID, currentAgentID, err.Error())
			return
		}

		chat, err = a.store.GetChat(chatID)
		if err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		chat.LastRuntimeSession = model.LastRuntimeSession{
			AgentID:   currentAgentID,
			SessionID: result.SessionID,
			UpdatedAt: time.Now().UTC(),
		}
		chat.CurrentAgentID = currentAgentID
		chat.UpdatedAt = time.Now().UTC()
		if pendingHandoverAgent.ID == "" {
			chat.PendingHandoverAgentID = ""
		}
		if err := a.store.SaveChat(chat); err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}

		if pendingHandoverAgent.ID == "" {
			break
		}
		if _, errorPayload := a.validateHandoverTarget(pendingHandoverAgent.ID, currentAgentID); errorPayload != nil {
			a.finishChatWithErrorPayload(chatID, currentTurnID, currentAgentID, *errorPayload)
			return
		}
		events, err := a.store.ListEvents(chatID, 0)
		if err == nil {
			_ = a.store.WriteSummary(chatID, model.BuildChatSummary(events))
		}

		nextPrompt := buildHandoverPrompt(currentPrompt, lastAssistant)
		nextTurnID := id.New()
		chat.PendingHandoverAgentID = ""
		chat.CurrentAgentID = pendingHandoverAgent.ID
		chat.UpdatedAt = time.Now().UTC()
		chat.ActiveTurnID = nextTurnID
		chat.Stream = model.ChatStreamState{
			Status:    "streaming",
			AgentID:   pendingHandoverAgent.ID,
			StartedAt: time.Now().UTC(),
		}
		chat.ParticipantAgentIDs = appendUnique(chat.ParticipantAgentIDs, pendingHandoverAgent.ID)
		if err := a.store.SaveChat(chat); err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		if err := a.appendHandoverEvent(chatID, currentTurnID, pendingHandoverAgent.ID, handoverSubtypeOccurred, pendingHandoverAgent, pendingHandoverNote); err != nil {
			a.finishChatWithError(chatID, err.Error())
			return
		}
		currentAgentID = pendingHandoverAgent.ID
		currentPrompt = nextPrompt
		currentHandoverNote = pendingHandoverNote
		currentTurnID = nextTurnID
	}

	if pending, ok := a.consumePendingSteer(chatID, controller); ok {
		if restartErr := a.restartAfterSteer(chatID, currentAgentID, pending, nil); restartErr != nil {
			a.finishChatWithError(chatID, restartErr.Error())
		}
		return
	}
	a.finishChatSuccess(chatID)
}

func (a *App) hasPendingSteer(chatID string, controller *chatRunController) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.runs[chatID] != controller {
		return false
	}
	for _, pending := range controller.pendingInterrupts {
		if !pending.triggered {
			return true
		}
	}
	return false
}

func (a *App) triggerPendingSteer(chatID string, controller *chatRunController) {
	a.mu.Lock()
	if a.runs[chatID] != controller {
		a.mu.Unlock()
		return
	}
	triggered := false
	for i := range controller.pendingInterrupts {
		if !controller.pendingInterrupts[i].triggered {
			controller.pendingInterrupts[i].triggered = true
			triggered = true
		}
	}
	if !triggered {
		a.mu.Unlock()
		return
	}
	cancel := controller.cancel
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *App) consumeTriggeredPendingSteer(chatID string, controller *chatRunController) ([]pendingInterrupt, []pendingInterrupt, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.runs[chatID] != controller {
		return nil, nil, false
	}
	delivered, remaining := splitPendingSteers(controller.pendingInterrupts)
	if len(delivered) == 0 {
		return nil, nil, false
	}
	controller.pendingInterrupts = nil
	return delivered, remaining, true
}

func (a *App) consumePendingSteer(chatID string, controller *chatRunController) ([]pendingInterrupt, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.runs[chatID] != controller || len(controller.pendingInterrupts) == 0 {
		return nil, false
	}
	pending := append([]pendingInterrupt(nil), controller.pendingInterrupts...)
	controller.pendingInterrupts = nil
	return pending, true
}

func splitPendingSteers(pending []pendingInterrupt) ([]pendingInterrupt, []pendingInterrupt) {
	delivered := make([]pendingInterrupt, 0, len(pending))
	remaining := make([]pendingInterrupt, 0, len(pending))
	for _, item := range pending {
		if item.triggered {
			item.triggered = false
			delivered = append(delivered, item)
			continue
		}
		remaining = append(remaining, item)
	}
	return delivered, remaining
}

func pendingSteerStates(pending []pendingInterrupt) []model.PendingSteerState {
	states := make([]model.PendingSteerState, 0, len(pending))
	for _, item := range pending {
		if item.triggered {
			continue
		}
		states = append(states, model.PendingSteerState{
			ID:          item.id,
			Content:     item.content,
			Attachments: item.attachments,
			QueuedAt:    item.queuedAt,
		})
	}
	return states
}

func (a *App) restartAfterSteer(chatID, agentID string, delivered []pendingInterrupt, remaining []pendingInterrupt) error {
	if agentID == "" {
		return ErrBadRequest
	}
	if len(delivered) == 0 {
		return ErrBadRequest
	}

	a.mu.Lock()
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		a.mu.Unlock()
		return a.mapError(err)
	}
	agent, err := a.store.GetAgent(agentID)
	if err != nil {
		a.mu.Unlock()
		return a.mapError(err)
	}
	runtimeRecord, err := a.store.GetRuntime(agent.RuntimeID)
	if err != nil {
		a.mu.Unlock()
		return a.mapError(err)
	}
	if runtimeRecord.Status == model.RuntimeStatusMissing {
		a.mu.Unlock()
		return ErrConflict
	}

	now := time.Now().UTC()
	turnID := id.New()
	chat.ActiveTurnID = turnID
	chat.CurrentAgentID = agentID
	chat.UpdatedAt = now
	chat.Stream = model.ChatStreamState{
		Status:        "streaming",
		AgentID:       agentID,
		StartedAt:     now,
		PendingSteers: pendingSteerStates(remaining),
	}
	chat.PendingHandoverAgentID = ""
	chat.ParticipantAgentIDs = appendUnique(chat.ParticipantAgentIDs, agentID)
	if err := a.store.SaveChat(chat); err != nil {
		a.mu.Unlock()
		return err
	}

	userEvents := make([]model.Event, 0, len(delivered))
	for _, pending := range delivered {
		userEvent, err := a.store.AppendEvent(chatID, model.Event{
			Type:         model.EventTypeMessage,
			TS:           now,
			TurnID:       turnID,
			ActorAgentID: agentID,
			Message: &model.MessagePayload{
				Role:         model.MessageRoleUser,
				Content:      pending.content,
				Attachments:  pending.attachments,
				UserSteer:    true,
				SteerAgentID: agentID,
			},
		})
		if err != nil {
			a.mu.Unlock()
			return err
		}
		userEvents = append(userEvents, userEvent)
	}

	ctx, cancel := context.WithCancel(context.Background())
	nextController := &chatRunController{
		cancel:            cancel,
		pendingInterrupts: append([]pendingInterrupt(nil), remaining...),
	}
	a.runs[chatID] = nextController
	a.mu.Unlock()

	for _, userEvent := range userEvents {
		a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: userEvent})
	}
	go a.runChat(ctx, nextController, chatID, agentID, turnID, buildInterruptPrompt(delivered))
	return nil
}

func buildInterruptPrompt(pending []pendingInterrupt) string {
	parts := make([]string, 0, len(pending))
	for _, item := range pending {
		parts = append(parts, model.AppendAttachmentLinks(item.content, item.attachments))
	}
	return "The user interrupted the previous run with new steering. Treat this as the latest instruction and continue from the newest context.\n\nUser steer:\n" + strings.Join(parts, "\n\n")
}

func (a *App) updateLastRuntimeSession(chatID, agentID, sessionID string) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return
	}
	chat.LastRuntimeSession = model.LastRuntimeSession{
		AgentID:   agentID,
		SessionID: sessionID,
		UpdatedAt: time.Now().UTC(),
	}
	chat.UpdatedAt = time.Now().UTC()
	_ = a.store.SaveChat(chat)
}

func (a *App) finishChatSuccess(chatID string) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return
	}
	chat.Stream.Status = "idle"
	chat.Stream.LastError = ""
	chat.Stream.CancelRequested = false
	chat.Stream.PendingSteers = nil
	chat.PendingHandoverAgentID = ""
	chat.UpdatedAt = time.Now().UTC()
	_ = a.store.SaveChat(chat)
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindDone})
}

func (a *App) finishChatCanceled(chatID string) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return
	}
	chat.Stream.Status = "idle"
	chat.Stream.LastError = ""
	chat.Stream.CancelRequested = false
	chat.Stream.PendingSteers = nil
	chat.PendingHandoverAgentID = ""
	chat.UpdatedAt = time.Now().UTC()
	_ = a.store.SaveChat(chat)
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindDone})
}

func (a *App) finishChatWithError(chatID, message string) {
	a.finishChatWithErrorPayload(chatID, "", "", model.ErrorPayload{
		Subtype: "internal",
		Code:    "internal_error",
		Message: message,
	})
}

func (a *App) finishChatWithRuntimeError(chatID, turnID, actorAgentID, message string) {
	a.finishChatWithErrorPayload(chatID, turnID, actorAgentID, model.ErrorPayload{
		Subtype: "runtime",
		Code:    "runtime_error",
		Message: message,
	})
}

func (a *App) finishChatWithErrorPayload(chatID, turnID, actorAgentID string, payload model.ErrorPayload) {
	chat, err := a.store.GetChat(chatID)
	if err == nil {
		if turnID == "" {
			turnID = chat.ActiveTurnID
		}
		if actorAgentID == "" {
			actorAgentID = chat.Stream.AgentID
			if actorAgentID == "" {
				actorAgentID = chat.CurrentAgentID
			}
		}
		if payload.AgentID == "" {
			payload.AgentID = actorAgentID
		}
		if payload.AgentName == "" && payload.AgentID != "" {
			if agent, agentErr := a.store.GetAgent(payload.AgentID); agentErr == nil {
				payload.AgentName = agent.Name
			}
		}
		if payload.Message == "" {
			payload.Message = "Chat stopped because an error occurred."
		}
		if payload.Code == "" {
			payload.Code = "error"
		}
		if payload.Subtype == "" {
			payload.Subtype = "runtime"
		}
		event, appendErr := a.store.AppendEvent(chatID, model.Event{
			Type:         model.EventTypeError,
			TS:           time.Now().UTC(),
			TurnID:       turnID,
			ActorAgentID: actorAgentID,
			Error:        &payload,
		})
		if appendErr == nil {
			a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: event})
		}
		chat.Stream.Status = "idle"
		chat.Stream.LastError = payload.Message
		chat.Stream.CancelRequested = true
		chat.Stream.PendingSteers = nil
		chat.PendingHandoverAgentID = ""
		chat.UpdatedAt = time.Now().UTC()
		_ = a.store.SaveChat(chat)
	}
	if payload.Message == "" {
		payload.Message = "Chat stopped because an error occurred."
	}
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindError, Error: payload.Message})
}

func appendUnique(values []string, next string) []string {
	for _, value := range values {
		if value == next {
			return values
		}
	}
	return append(values, next)
}

func toolCallKey(agentID, callID string) string {
	return agentID + "\x00" + callID
}

func promptSkills(skills []runtime.SkillContext) []promptbuilder.Skill {
	if len(skills) == 0 {
		return nil
	}
	out := make([]promptbuilder.Skill, 0, len(skills))
	for _, skill := range skills {
		out = append(out, promptbuilder.Skill{Name: skill.Name})
	}
	return out
}
