package prompt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

func TestBuildSystemPromptExpandsTypedMemoryFiles(t *testing.T) {
	dir := t.TempDir()
	userDir := filepath.Join(dir, "memory")
	projDir := filepath.Join(dir, "projects", "proj-x", "memory")
	if err := os.MkdirAll(userDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userDir, "MEMORY.md"), []byte("# Memory Index\n\n- [Em-dash style](em-dash-mu-1.md) — prefers em-dashes\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userDir, "em-dash-mu-1.md"), []byte("---\nname: em-dash-mu-1\ndescription: prefers em-dashes\n---\n\nPrefers em-dashes over semicolons.\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projDir, "MEMORY.md"), []byte("# Memory Index\n\n- [Pnpm only](pnpm-mp-1.md) — never run npm install\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(projDir, "pnpm-mp-1.md"), []byte("---\nname: pnpm-mp-1\n---\n\nThis repo uses pnpm workspaces. Never run npm install at the repo root.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := BuildSystemPrompt(SystemPromptInput{
		Agent:            model.AgentConfig{ID: "a", Name: "Aria"},
		Runtime:          model.RuntimeRecord{ID: "rt", Provider: "claude"},
		UserMemoryDir:    userDir,
		ProjectMemoryDir: projDir,
	})
	if !strings.Contains(got, "## User Memory") {
		t.Fatalf("expected ## User Memory section\n%s", got)
	}
	if !strings.Contains(got, "### Em-dash style") {
		t.Fatalf("expected per-entry title heading inlined\n%s", got)
	}
	if !strings.Contains(got, "Prefers em-dashes over semicolons.") {
		t.Fatalf("expected user memory body inlined\n%s", got)
	}
	if strings.Contains(got, "description: prefers em-dashes") {
		t.Fatalf("frontmatter should be stripped before injection\n%s", got)
	}
	if !strings.Contains(got, "## Project Memory") {
		t.Fatalf("expected ## Project Memory section\n%s", got)
	}
	if !strings.Contains(got, "pnpm workspaces") {
		t.Fatalf("expected project memory body inlined\n%s", got)
	}

	// Missing dir → section omitted.
	got2 := BuildSystemPrompt(SystemPromptInput{
		Agent:         model.AgentConfig{ID: "a", Name: "Aria"},
		Runtime:       model.RuntimeRecord{ID: "rt"},
		UserMemoryDir: filepath.Join(dir, "nope"),
	})
	if strings.Contains(got2, "## User Memory") {
		t.Fatalf("missing memory dir must not emit section\n%s", got2)
	}
}

func TestBuildSystemPromptFallsBackToLegacyMemoryFile(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "USER.md")
	if err := os.WriteFile(legacy, []byte("- Prefers em-dashes over semicolons.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	got := BuildSystemPrompt(SystemPromptInput{
		Agent:                model.AgentConfig{ID: "a", Name: "Aria"},
		Runtime:              model.RuntimeRecord{ID: "rt"},
		UserMemoryDir:        filepath.Join(dir, "memory"), // does not exist yet
		LegacyUserMemoryPath: legacy,
	})
	if !strings.Contains(got, "## User Memory") {
		t.Fatalf("legacy fallback should emit User Memory section\n%s", got)
	}
	if !strings.Contains(got, "Prefers em-dashes over semicolons.") {
		t.Fatalf("legacy file body must be inlined\n%s", got)
	}
}

func TestExpandMemoryIndexCapsRunawayBodies(t *testing.T) {
	dir := t.TempDir()
	memDir := filepath.Join(dir, "memory")
	if err := os.MkdirAll(memDir, 0o755); err != nil {
		t.Fatal(err)
	}
	big := strings.Repeat("a", memoryReadCap*2)
	if err := os.WriteFile(filepath.Join(memDir, "big-mu-1.md"), []byte("---\nname: big-mu-1\n---\n\n"+big+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(memDir, "MEMORY.md"), []byte("- [Big](big-mu-1.md) — runaway\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := expandMemoryIndex(memDir)
	if !strings.Contains(got, "[memory truncated]") {
		t.Fatalf("expected truncation marker on oversized memory")
	}
}

func TestExpandMemoryIndexRejectsTraversalLinks(t *testing.T) {
	dir := t.TempDir()
	memDir := filepath.Join(dir, "memory")
	if err := os.MkdirAll(memDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// A sibling file the renderer must refuse to read via a `..` link.
	if err := os.WriteFile(filepath.Join(dir, "secret.md"), []byte("secret\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(memDir, "MEMORY.md"), []byte("- [Sneaky](../secret.md) — escape\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := expandMemoryIndex(memDir); strings.Contains(got, "secret") {
		t.Fatalf("traversal link must be ignored, got %q", got)
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
		Skills:          []Skill{{Name: "problem-framing"}},
		SummaryPath:     "/tmp/chat-summary.md",
		ChatSessionDir:  "/home/user/.crew44/chats/chat-abc",
		HandoverNote:    "Tell the user an English story.",
	})

	required := []string{
		"## Crew44 Context",
		"Crew44 is a local-first multi-agent workteam",
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
		"problem-framing",
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
	// Shared routing guidance lets every agent route — not just the Partner.
	// The phrasing is generic (scope-based) so it does not name specific roles.
	for _, want := range []string{
		"Routing:",
		"hand off rather than attempting the work yourself",
		"Route the moment you recognize the scope match",
		"/home/user/.crew44/chats/chat-abc/handover/<short-slug>.md",
		"do not create files under `/tmp` or the project workdir",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("system prompt missing shared routing guidance %q:\n%s", want, got)
		}
	}
	for _, leak := range []string{
		"Coding Agent —",
		"Product Agent —",
		"Designer —",
	} {
		if strings.Contains(got, leak) {
			t.Fatalf("shared routing guidance should not name specific agent roles %q:\n%s", leak, got)
		}
	}
}

func TestBuildSystemPromptUsesAgentDescriptionInHandoverList(t *testing.T) {
	current := model.AgentConfig{ID: "agent-a", Name: "Aria"}
	withDescription := model.AgentConfig{
		ID:          "agent-b",
		Name:        "Product Agent",
		Description: "Product and UX reasoning specialist. Turns intent into scope and acceptance criteria.",
		Instruction: "## Long Instruction Block\n\nThis very long instruction would otherwise be inlined…",
	}
	derivedOnly := model.AgentConfig{
		ID:          "agent-c",
		Name:        "Designer",
		Instruction: "First paragraph that becomes the description.\n\nSecond paragraph that should not leak into the description.",
	}

	got := BuildSystemPrompt(SystemPromptInput{
		Agent:           current,
		Runtime:         model.RuntimeRecord{ID: "claude", Provider: "claude"},
		AvailableAgents: []model.AgentConfig{current, withDescription, derivedOnly},
	})

	if !strings.Contains(got, "Product and UX reasoning specialist. Turns intent into scope and acceptance criteria.") {
		t.Fatalf("expected explicit Description to appear in handover list:\n%s", got)
	}
	if strings.Contains(got, "Long Instruction Block") {
		t.Fatalf("Description should win over Instruction for agents with both:\n%s", got)
	}
	if !strings.Contains(got, "First paragraph that becomes the description.") {
		t.Fatalf("expected derived description from first paragraph:\n%s", got)
	}
	if strings.Contains(got, "Second paragraph that should not leak") {
		t.Fatalf("derived description should stop at the first paragraph:\n%s", got)
	}
}

func TestBuildSystemPromptDoesNotInvitePermissionBeforeClearHandover(t *testing.T) {
	current := model.AgentConfig{
		ID:          "partner",
		Name:        "Partner",
		Description: "Leads the crew and coordinates handoffs.",
	}
	coding := model.AgentConfig{
		ID:          "coding",
		Name:        "Coding Agent",
		Description: "Implements changes in the codebase. Responsible for reading and editing code, debugging stack traces and unexpected behavior, writing tests, refactoring, and shipping a fix end-to-end.",
	}

	got := BuildSystemPrompt(SystemPromptInput{
		Agent:           current,
		Runtime:         model.RuntimeRecord{ID: "claude", Provider: "claude"},
		AvailableAgents: []model.AgentConfig{current, coding},
	})

	for _, want := range []string{
		"Make the handover decision yourself. Do not ask the user whether to hand over.",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("system prompt missing routing guard %q:\n%s", want, got)
		}
	}
}
