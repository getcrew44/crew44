package agent

import (
	"strings"
	"testing"
)

func TestClaudeToolResultIncludesToolNameFromToolUseID(t *testing.T) {
	backend := &claudeBackend{}
	toolNamesByID := make(map[string]string)
	messages := make(chan Message, 2)
	var output strings.Builder

	backend.handleAssistant(claudeSDKMessage{
		Message: []byte(`{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"README.md"}}]}`),
	}, messages, &output, map[string]TokenUsage{}, toolNamesByID)

	toolUse := <-messages
	if toolUse.Type != MessageToolUse {
		t.Fatalf("expected tool-use message, got %s", toolUse.Type)
	}
	if toolUse.Tool != "Read" {
		t.Fatalf("expected tool name Read, got %q", toolUse.Tool)
	}

	backend.handleUser(claudeSDKMessage{
		Message: []byte(`{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]}`),
	}, messages, toolNamesByID)

	toolResult := <-messages
	if toolResult.Type != MessageToolResult {
		t.Fatalf("expected tool-result message, got %s", toolResult.Type)
	}
	if toolResult.Tool != "Read" {
		t.Fatalf("expected tool result to keep tool name Read, got %q", toolResult.Tool)
	}
	if _, ok := toolNamesByID["toolu_1"]; ok {
		t.Fatalf("expected completed tool id to be removed")
	}
}
