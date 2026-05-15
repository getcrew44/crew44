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
				Content: "please investigate [@Aria](mention://agent/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)\n<CREW44_AGENT_HANDOVER agent_id=\"cccccccc-cccc-cccc-cccc-cccccccccccc\">Investigate this.</CREW44_AGENT_HANDOVER>",
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
				Content: "final answer\n<CREW44_AGENT_HANDOVER agent_id=\"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\">Review the answer.</CREW44_AGENT_HANDOVER>",
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
	if strings.Contains(summary, "CREW44_AGENT_HANDOVER") {
		t.Fatalf("summary should strip handoff marker, got %q", summary)
	}
}

func TestBuildChatSummaryIncludesAttachmentLinksWithoutThumbnailData(t *testing.T) {
	events := []Event{
		{
			Seq:          1,
			Type:         EventTypeMessage,
			TurnID:       "turn-1",
			ActorAgentID: "agent-a",
			Message: &MessagePayload{
				Role:    MessageRoleUser,
				Content: "please inspect",
				Attachments: []MessageAttachment{
					{
						DisplayName: "proxy.txt",
						Path:        "/Users/mindivelabs/proxy.txt",
						Kind:        "file",
					},
					{
						DisplayName:      "screen.png",
						Path:             "/Users/mindivelabs/screen.png",
						Kind:             "image",
						ThumbnailJPEGB64: "base64-thumbnail",
					},
					{
						DisplayName: "Design Kit",
						Path:        "/Users/mindivelabs/Design Kit",
						Kind:        "folder",
					},
				},
			},
		},
	}

	summary := BuildChatSummary(events)
	if !strings.Contains(summary, "User: please inspect\n\nAttachments:") {
		t.Fatalf("summary should include attachment section after user text, got %q", summary)
	}
	if !strings.Contains(summary, "- [proxy.txt](/Users/mindivelabs/proxy.txt)") ||
		!strings.Contains(summary, "- [screen.png](/Users/mindivelabs/screen.png)") ||
		!strings.Contains(summary, "- [Design Kit](/Users/mindivelabs/Design Kit)") {
		t.Fatalf("summary should include attachment links, got %q", summary)
	}
	if strings.Contains(summary, "base64-thumbnail") {
		t.Fatalf("summary should not include thumbnail base64, got %q", summary)
	}
}
