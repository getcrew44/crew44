package model

import (
	"strings"
	"testing"
)

func TestBuildChatSummaryKeepsUserAndFinalAssistantMessages(t *testing.T) {
	events := []Event{
		{
			Seq:          1,
			Type:         EventTypeMessage,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			Message: &MessagePayload{
				Role:    MessageRoleUser,
				Content: "please investigate [@Aria](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa) ^<CREWAI_HANDOFF>cccccccc-cccc-cccc-cccc-cccccccccccc</CREWAI_HANDOFF>",
			},
		},
		{
			Seq:          2,
			Type:         EventTypeThinking,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			Thinking: &ThinkingPayload{
				Content: "thinking",
			},
		},
		{
			Seq:          3,
			Type:         EventTypeMessage,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			Message: &MessagePayload{
				Role:    MessageRoleAssistant,
				Content: "let me check",
			},
		},
		{
			Seq:          4,
			Type:         EventTypeToolCall,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			ToolCall: &ToolCallPayload{
				Name: "search",
			},
		},
		{
			Seq:          5,
			Type:         EventTypeToolCallResult,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			ToolCallResult: &ToolCallResultPayload{
				Name:   "search",
				Output: "done",
			},
		},
		{
			Seq:          6,
			Type:         EventTypeMessage,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			Message: &MessagePayload{
				Role:    MessageRoleAssistant,
				Content: "final answer ^<CREWAI_HANDOFF>bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb</CREWAI_HANDOFF>",
			},
		},
	}

	summary := BuildChatSummary(events)
	if !strings.Contains(summary, "please investigate [@Aria](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)") {
		t.Fatalf("summary should keep original user content, got %q", summary)
	}
	if !strings.Contains(summary, "final answer") {
		t.Fatalf("summary should include final assistant message, got %q", summary)
	}
	if strings.Contains(summary, "thinking") {
		t.Fatalf("summary should omit thinking content, got %q", summary)
	}
	if strings.Contains(summary, "let me check") {
		t.Fatalf("summary should omit intermediate assistant messages before the last tool call, got %q", summary)
	}
	if strings.Contains(summary, "<CREWAI_HANDOFF>") {
		t.Fatalf("summary should strip handoff marker, got %q", summary)
	}
}
