package app

import (
	"fmt"
	"strings"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/broker"
	"github.com/getcrew44/crew44/daemon/internal/model"
)

const (
	handoverSubtypeScheduled = "scheduled"
	handoverSubtypeOccurred  = "occurred"
)

func (a *App) availableHandoverAgents() ([]model.AgentConfig, error) {
	agents, err := a.store.ListAgents()
	if err != nil {
		return nil, err
	}
	out := make([]model.AgentConfig, 0, len(agents))
	for _, agent := range agents {
		if agent.ArchivedAt.IsZero() && a.runtimeAvailable(agent.RuntimeID) {
			out = append(out, agent)
		}
	}
	return out, nil
}

func (a *App) validateHandoverTarget(agentID, currentAgentID string) (model.AgentConfig, *model.ErrorPayload) {
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return model.AgentConfig{}, &model.ErrorPayload{
			Subtype: "handover",
			Code:    "empty_handover_target",
			Message: "Agent handover target is empty.",
		}
	}
	if agentID == currentAgentID {
		payload := &model.ErrorPayload{
			Subtype:       "handover",
			Code:          "self_handover",
			Message:       "Agent attempted to hand over to itself.",
			TargetAgentID: agentID,
		}
		if agent, err := a.store.GetAgent(agentID); err == nil {
			payload.TargetAgentName = agent.Name
			payload.Message = fmt.Sprintf("Agent attempted to hand over to itself: %s.", agent.Name)
		}
		return model.AgentConfig{}, payload
	}
	agent, err := a.store.GetAgent(agentID)
	if err != nil {
		return model.AgentConfig{}, &model.ErrorPayload{
			Subtype:       "handover",
			Code:          "unknown_handover_target",
			Message:       fmt.Sprintf("Agent handover target %q does not exist.", agentID),
			TargetAgentID: agentID,
		}
	}
	payload := &model.ErrorPayload{
		Subtype:         "handover",
		TargetAgentID:   agent.ID,
		TargetAgentName: agent.Name,
	}
	if !agent.ArchivedAt.IsZero() {
		payload.Code = "archived_handover_target"
		payload.Message = fmt.Sprintf("Agent handover target %q is archived.", agent.Name)
		return model.AgentConfig{}, payload
	}
	runtimeRecord, err := a.store.GetRuntime(agent.RuntimeID)
	if err != nil || runtimeRecord.Status != model.RuntimeStatusAvailable {
		payload.Code = "handover_runtime_unavailable"
		payload.Message = fmt.Sprintf("Agent handover target %q does not have an available runtime.", agent.Name)
		return model.AgentConfig{}, payload
	}
	return agent, nil
}

func (a *App) runtimeAvailable(runtimeID string) bool {
	runtimeRecord, err := a.store.GetRuntime(runtimeID)
	return err == nil && runtimeRecord.Status == model.RuntimeStatusAvailable
}

func buildHandoverPrompt(currentPrompt, sourceMessage string) string {
	prompt := strings.TrimSpace(currentPrompt)
	source := strings.TrimSpace(sourceMessage)
	if prompt == "" && source != "" {
		return source
	}
	var b strings.Builder
	b.WriteString("Continue from the previous agent handover.")
	if prompt != "" {
		b.WriteString("\n\nOriginal user request:\n")
		b.WriteString(prompt)
	}
	if source != "" {
		b.WriteString("\n\nPrevious agent message:\n")
		b.WriteString(source)
	}
	return b.String()
}

func (a *App) appendHandoverEvent(chatID, turnID, actorAgentID, subtype string, agent model.AgentConfig, note string) error {
	actorAgentName := ""
	if actorAgentID != "" {
		if actor, err := a.store.GetAgent(actorAgentID); err == nil {
			actorAgentName = actor.Name
		}
	}
	event, err := a.store.AppendEvent(chatID, model.Event{
		Type:           model.EventTypeHandover,
		TS:             time.Now().UTC(),
		TurnID:         turnID,
		ActorAgentID:   actorAgentID,
		ActorAgentName: actorAgentName,
		Handover: &model.HandoverPayload{
			Subtype:   subtype,
			AgentID:   agent.ID,
			AgentName: agent.Name,
			Note:      note,
		},
	})
	if err != nil {
		return err
	}
	a.broker.Publish(chatID, broker.Notification[model.Event]{Kind: broker.KindEvent, Value: event})
	return nil
}
