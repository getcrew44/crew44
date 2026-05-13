package prompt

import (
	"strings"
	"testing"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

func TestBuildSystemPromptStructuresRuntimeContext(t *testing.T) {
	current := model.AgentConfig{
		ID:          "agent-a",
		Name:        "Personal partner",
		Instruction: "Always end sentences with meow.",
		RuntimeID:   "claude",
	}
	other := model.AgentConfig{
		ID:          "agent-b",
		Name:        "Product Agent",
		Instruction: "Shape product requirements.",
		RuntimeID:   "codex",
	}

	got := BuildSystemPrompt(SystemPromptInput{
		Agent:           current,
		Runtime:         model.RuntimeRecord{ID: "claude", Provider: "claude"},
		AvailableAgents: []model.AgentConfig{current, other},
		Skills:          []Skill{{Name: "handoff-routing"}},
		SummaryPath:     "/tmp/chat-summary.md",
		HandoverNote:    "Tell the user an English story.",
	})

	required := []string{
		"## CrewAI Context",
		"CrewAI Desktop is a local-first multi-agent workteam",
		"## Agent Identity",
		"- name: Personal partner",
		"- uuid: agent-a",
		"## Agent Instructions",
		"Always end sentences with meow.",
		"## Handover Task",
		"You are the agent receiving this handover.",
		"Tell the user an English story.",
		"Do not hand over to yourself.",
		"## Conversation Summary",
		"/tmp/chat-summary.md",
		"## Available Skills",
		"handoff-routing",
		"## Available Agents For Handover",
		"uuid: agent-b",
		"## Handover Output Protocol",
		model.AgentHandoverMarkerExample,
	}
	for _, want := range required {
		if !strings.Contains(got, want) {
			t.Fatalf("system prompt missing %q\n%s", want, got)
		}
	}
	if strings.Contains(got, "uuid: agent-a\n  name: Personal partner") {
		t.Fatalf("current agent should not appear in handover targets:\n%s", got)
	}
}
