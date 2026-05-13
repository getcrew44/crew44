package app

import (
	"fmt"
	"strings"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/broker"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
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

func (a *App) validHandoverTarget(agentID, currentAgentID string) (model.AgentConfig, bool) {
	if strings.TrimSpace(agentID) == "" || agentID == currentAgentID {
		return model.AgentConfig{}, false
	}
	agent, err := a.store.GetAgent(agentID)
	if err != nil || !agent.ArchivedAt.IsZero() || !a.runtimeAvailable(agent.RuntimeID) {
		return model.AgentConfig{}, false
	}
	return agent, true
}

func (a *App) runtimeAvailable(runtimeID string) bool {
	runtimeRecord, err := a.store.GetRuntime(runtimeID)
	return err == nil && runtimeRecord.Status == model.RuntimeStatusAvailable
}

func withHandoverInstructions(agent model.AgentConfig, availableAgents []model.AgentConfig) model.AgentConfig {
	agent.Instruction = buildHandoverSystemPrompt(agent.Instruction, availableAgents)
	return agent
}

func buildHandoverSystemPrompt(base string, availableAgents []model.AgentConfig) string {
	var b strings.Builder
	if strings.TrimSpace(base) != "" {
		b.WriteString(strings.TrimSpace(base))
		b.WriteString("\n\n")
	}
	b.WriteString("Available agents for handover:\n")
	if len(availableAgents) == 0 {
		b.WriteString("- none\n")
	} else {
		for _, agent := range availableAgents {
			fmt.Fprintf(&b, "- uuid: %s\n  name: %s\n  description: %s\n", agent.ID, agent.Name, handoverDescription(agent.Instruction))
		}
	}
	b.WriteString("\nAgent handover protocol:\n")
	b.WriteString("If another listed agent should continue this chat, output exactly one standalone line using this format:\n")
	b.WriteString(model.AgentHandoverMarkerExample)
	b.WriteString("\nReplace agent_uuid with the target agent uuid from the list above. Replace the sentence with a concise instruction for the next agent. Do not put any other text on that line.\n")
	return b.String()
}

func handoverDescription(instruction string) string {
	description := strings.Join(strings.Fields(instruction), " ")
	if description == "" {
		return "No description provided."
	}
	const maxDescriptionLen = 240
	if len(description) <= maxDescriptionLen {
		return description
	}
	return strings.TrimSpace(description[:maxDescriptionLen]) + "..."
}

func buildHandoverPrompt(currentPrompt, handoverNote, sourceMessage string) string {
	prompt := strings.TrimSpace(currentPrompt)
	note := strings.TrimSpace(handoverNote)
	source := strings.TrimSpace(sourceMessage)
	if prompt == "" && note == "" && source != "" {
		return source
	}
	var b strings.Builder
	b.WriteString("A previous agent handed this chat to you.")
	if prompt != "" {
		b.WriteString("\n\nUser request:\n")
		b.WriteString(prompt)
	}
	if note != "" {
		b.WriteString("\n\nHandover note:\n")
		b.WriteString(note)
	}
	if source != "" {
		b.WriteString("\n\nPrevious agent message:\n")
		b.WriteString(source)
	}
	return b.String()
}

func (a *App) appendHandoverEvent(chatID, turnID, actorAgentID, subtype string, agent model.AgentConfig, note string) error {
	event, err := a.store.AppendEvent(chatID, model.Event{
		Type:         model.EventTypeHandover,
		TS:           time.Now().UTC(),
		TurnID:       turnID,
		ActorAgentID: actorAgentID,
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
