package app

import (
	"context"
	"errors"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/getcrew44/crew44/daemon/internal/model"
	promptbuilder "github.com/getcrew44/crew44/daemon/internal/prompt"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

var errChatStoppedAfterError = errors.New("chat stopped after error event")

type chatRunController struct {
	cancel           context.CancelFunc
	pendingInterrupt *pendingInterrupt
}

type pendingInterrupt struct {
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
	return chat, nil
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
	if controller.pendingInterrupt != nil {
		return model.ChatRecord{}, ErrConflict
	}
	now := time.Now().UTC()
	controller.pendingInterrupt = &pendingInterrupt{
		content:     content,
		attachments: attachments,
		queuedAt:    now,
	}
	chat.Stream.PendingSteer = &model.PendingSteerState{
		Content:     content,
		Attachments: attachments,
		QueuedAt:    now,
	}
	chat.UpdatedAt = now
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
	}
	return chat, nil
}

func (a *App) CancelPendingSteer(chatID string) (model.ChatRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
	chat = a.reconcileStaleStreamLocked(chat)
	controller := a.runs[chatID]
	if controller == nil || controller.pendingInterrupt == nil {
		return model.ChatRecord{}, ErrConflict
	}
	if controller.pendingInterrupt.triggered {
		return model.ChatRecord{}, ErrConflict
	}
	controller.pendingInterrupt = nil
	chat.Stream.PendingSteer = nil
	chat.UpdatedAt = time.Now().UTC()
	if err := a.store.SaveChat(chat); err != nil {
		return model.ChatRecord{}, err
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
		agentSkills, err := a.resolveAgentSkills(agent.SkillIDs)
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
		result, err := a.engine.Run(ctx, runtime.RunRequest{
			Runtime:         runtimeRecord,
			Agent:           runtimeAgent,
			AgentSkills:     agentSkills,
			Prompt:          currentPrompt,
			WorkDir:         project.Workdir,
			RuntimeEnvDir:   a.store.RuntimeEnvDir(currentAgentID),
			ResumeSessionID: resumeSessionID,
		}, func(streamEvent runtime.StreamEvent) error {
			event := model.Event{
				Type:           streamEvent.Type,
				TS:             time.Now().UTC(),
				TurnID:         currentTurnID,
				ActorAgentID:   currentAgentID,
				Message:        streamEvent.Message,
				Thinking:       streamEvent.Thinking,
				ToolCall:       streamEvent.ToolCall,
				ToolCallResult: streamEvent.ToolCallResult,
				RuntimeSession: streamEvent.RuntimeSession,
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
				if pending, ok := a.consumeTriggeredPendingSteer(chatID, controller); ok {
					if restartErr := a.restartAfterSteer(chatID, currentAgentID, pending); restartErr != nil {
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
		if restartErr := a.restartAfterSteer(chatID, currentAgentID, pending); restartErr != nil {
			a.finishChatWithError(chatID, restartErr.Error())
		}
		return
	}
	a.finishChatSuccess(chatID)
}

func (a *App) hasPendingSteer(chatID string, controller *chatRunController) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.runs[chatID] == controller &&
		controller.pendingInterrupt != nil &&
		!controller.pendingInterrupt.triggered
}

func (a *App) triggerPendingSteer(chatID string, controller *chatRunController) {
	a.mu.Lock()
	if a.runs[chatID] != controller || controller.pendingInterrupt == nil || controller.pendingInterrupt.triggered {
		a.mu.Unlock()
		return
	}
	controller.pendingInterrupt.triggered = true
	cancel := controller.cancel
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *App) consumeTriggeredPendingSteer(chatID string, controller *chatRunController) (pendingInterrupt, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.runs[chatID] != controller || controller.pendingInterrupt == nil || !controller.pendingInterrupt.triggered {
		return pendingInterrupt{}, false
	}
	pending := *controller.pendingInterrupt
	controller.pendingInterrupt = nil
	return pending, true
}

func (a *App) consumePendingSteer(chatID string, controller *chatRunController) (pendingInterrupt, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.runs[chatID] != controller || controller.pendingInterrupt == nil {
		return pendingInterrupt{}, false
	}
	pending := *controller.pendingInterrupt
	controller.pendingInterrupt = nil
	return pending, true
}

func (a *App) restartAfterSteer(chatID, agentID string, pending pendingInterrupt) error {
	if agentID == "" {
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
		Status:    "streaming",
		AgentID:   agentID,
		StartedAt: now,
	}
	chat.PendingHandoverAgentID = ""
	chat.ParticipantAgentIDs = appendUnique(chat.ParticipantAgentIDs, agentID)
	if err := a.store.SaveChat(chat); err != nil {
		a.mu.Unlock()
		return err
	}

	userEvent, err := a.store.AppendEvent(chatID, model.Event{
		Type:         model.EventTypeMessage,
		TS:           now,
		TurnID:       turnID,
		ActorAgentID: agentID,
		Message: &model.MessagePayload{
			Role:        model.MessageRoleUser,
			Content:     pending.content,
			Attachments: pending.attachments,
			UserSteer:   true,
		},
	})
	if err != nil {
		a.mu.Unlock()
		return err
	}

	ctx, cancel := context.WithCancel(context.Background())
	nextController := &chatRunController{cancel: cancel}
	a.runs[chatID] = nextController
	a.mu.Unlock()

	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: userEvent})
	go a.runChat(ctx, nextController, chatID, agentID, turnID, buildInterruptPrompt(model.AppendAttachmentLinks(pending.content, pending.attachments)))
	return nil
}

func buildInterruptPrompt(content string) string {
	return "The user interrupted the previous run with new steering. Treat this as the latest instruction and continue from the newest context.\n\nUser steer:\n" + content
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
	chat.Stream.PendingSteer = nil
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
	chat.Stream.PendingSteer = nil
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
		chat.Stream.PendingSteer = nil
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
