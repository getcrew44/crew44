package prompt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

func TestBuildSystemPromptInjectsMemoryFiles(t *testing.T) {
	dir := t.TempDir()
	userPath := filepath.Join(dir, "USER.md")
	projPath := filepath.Join(dir, "MEMORY.md")
	if err := os.WriteFile(userPath, []byte("- Prefers em-dashes over semicolons.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(projPath, []byte("- This repo uses pnpm workspaces.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := BuildSystemPrompt(SystemPromptInput{
		Agent:             model.AgentConfig{ID: "a", Name: "Aria"},
		Runtime:           model.RuntimeRecord{ID: "rt", Provider: "claude"},
		UserMemoryPath:    userPath,
		ProjectMemoryPath: projPath,
	})
	if !strings.Contains(got, "## User Memory") {
		t.Fatalf("expected ## User Memory section\n%s", got)
	}
	if !strings.Contains(got, "Prefers em-dashes over semicolons.") {
		t.Fatalf("expected USER.md body inlined\n%s", got)
	}
	if !strings.Contains(got, "## Project Memory") {
		t.Fatalf("expected ## Project Memory section\n%s", got)
	}
	if !strings.Contains(got, "pnpm workspaces") {
		t.Fatalf("expected MEMORY.md body inlined\n%s", got)
	}

	// Missing path → section omitted.
	got2 := BuildSystemPrompt(SystemPromptInput{
		Agent:          model.AgentConfig{ID: "a", Name: "Aria"},
		Runtime:        model.RuntimeRecord{ID: "rt"},
		UserMemoryPath: filepath.Join(dir, "nope.md"),
	})
	if strings.Contains(got2, "## User Memory") {
		t.Fatalf("missing memory file must not emit section\n%s", got2)
	}

	// Empty path string → section omitted (do not stat cwd).
	got3 := BuildSystemPrompt(SystemPromptInput{
		Agent:          model.AgentConfig{ID: "a", Name: "Aria"},
		Runtime:        model.RuntimeRecord{ID: "rt"},
		UserMemoryPath: "",
	})
	if strings.Contains(got3, "## User Memory") {
		t.Fatalf("empty path must not emit section\n%s", got3)
	}
}

func TestReadMemoryFileCapsRunawayInput(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "USER.md")
	big := strings.Repeat("a", memoryReadCap*2)
	if err := os.WriteFile(path, []byte(big), 0o644); err != nil {
		t.Fatal(err)
	}
	got := readMemoryFile(path)
	if len(got) > memoryReadCap+len("\n[memory truncated]") {
		t.Fatalf("memory file read not capped: len=%d", len(got))
	}
	if !strings.Contains(got, "[memory truncated]") {
		t.Fatalf("expected truncation marker on oversized memory")
	}
}

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
