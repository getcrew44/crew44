package agent

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestCodexCommandExecutionOutputIsBounded(t *testing.T) {
	longOutput := strings.Repeat("x", codexToolOutputMaxBytes+1024)
	messages := make(chan Message, 1)
	client := &codexClient{
		notificationProtocol: "unknown",
		onMessage: func(msg Message) {
			messages <- msg
		},
	}
	line, err := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "item/completed",
		"params": map[string]any{
			"item": map[string]any{
				"type":             "commandExecution",
				"id":               "call_1",
				"aggregatedOutput": longOutput,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	client.handleLine(string(line))

	msg := <-messages
	if msg.Type != MessageToolResult {
		t.Fatalf("message type = %s, want %s", msg.Type, MessageToolResult)
	}
	if len(msg.Output) > codexToolOutputMaxBytes {
		t.Fatalf("output length = %d, want <= %d", len(msg.Output), codexToolOutputMaxBytes)
	}
	if !strings.Contains(msg.Output, "output truncated by CrewAI") {
		t.Fatalf("bounded output missing truncation marker")
	}
}

// TestBoundCodexToolOutputPreservesUTF8 ensures the truncation point is on
// a rune boundary. Naive byte-level slicing of multi-byte UTF-8 (CJK, emoji)
// can split a rune mid-sequence; downstream JSON-marshalling replaces the
// invalid bytes with U+FFFD, corrupting the last visible character.
func TestBoundCodexToolOutputPreservesUTF8(t *testing.T) {
	// 4-byte runes (emoji) — repeat enough to exceed the cap and force
	// truncation at an arbitrary offset.
	rune4 := "\U0001F600" // 😀, 4 bytes
	repeats := (codexToolOutputMaxBytes / len(rune4)) + 100
	input := strings.Repeat(rune4, repeats)

	bounded := boundCodexToolOutput(input)
	if !utf8.ValidString(bounded) {
		t.Fatalf("boundCodexToolOutput produced invalid UTF-8")
	}
	if !strings.Contains(bounded, "output truncated by CrewAI") {
		t.Fatalf("bounded output missing truncation marker")
	}
}
