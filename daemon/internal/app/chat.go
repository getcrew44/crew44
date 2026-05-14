package app

import (
	"context"
	"errors"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/id"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	promptbuilder "github.com/sqtech/crew-ai/crewai-repo/internal/prompt"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
)

var errChatStoppedAfterError = errors.New("chat stopped after error event")

func (a *App) PostMessage(chatID, content, targetAgentID string) (model.ChatRecord, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return model.ChatRecord{}, a.mapError(err)
	}
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
			Role:    model.MessageRoleUser,
			Content: content,
		},
	})
	if err != nil {
		return model.ChatRecord{}, err
	}
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: userEvent})

	ctx, cancel := context.WithCancel(context.Background())
	a.cancels[chatID] = cancel
	go a.runChat(ctx, chatID, targetAgentID, turnID, content)
	return chat, nil
}

func (a *App) runChat(ctx context.Context, chatID, agentID, turnID, prompt string) {
	defer func() {
		a.mu.Lock()
		delete(a.cancels, chatID)
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
				event.Message = &message
			}
			persisted, err := a.store.AppendEvent(chatID, event)
			if err != nil {
				return err
			}
			a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: persisted})
			return nil
		})
		if err != nil {
			if errors.Is(err, errChatStoppedAfterError) {
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

	a.finishChatSuccess(chatID)
}

func (a *App) finishChatSuccess(chatID string) {
	chat, err := a.store.GetChat(chatID)
	if err != nil {
		return
	}
	chat.Stream.Status = "idle"
	chat.Stream.LastError = ""
	chat.Stream.CancelRequested = false
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
