package model

import (
	"strings"
	"testing"
)

func TestEffectiveAgentDescriptionPrefersExplicitValue(t *testing.T) {
	agent := AgentConfig{
		Description: "  Custom description.  ",
		Instruction: "This instruction should be ignored.",
	}
	if got := EffectiveAgentDescription(agent); got != "Custom description." {
		t.Fatalf("expected trimmed custom description, got %q", got)
	}
}

func TestEffectiveAgentDescriptionFallsBackToInstruction(t *testing.T) {
	agent := AgentConfig{
		Instruction: "First paragraph summary.\n\nDeeper detail that the routing list does not need.",
	}
	got := EffectiveAgentDescription(agent)
	if !strings.HasPrefix(got, "First paragraph summary.") {
		t.Fatalf("expected derived first-paragraph, got %q", got)
	}
	if strings.Contains(got, "Deeper detail") {
		t.Fatalf("derived description leaked second paragraph: %q", got)
	}
}

func TestEffectiveAgentDescriptionTruncatesLongInput(t *testing.T) {
	long := strings.Repeat("a", 400)
	agent := AgentConfig{Instruction: long}
	got := EffectiveAgentDescription(agent)
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("expected ellipsis on truncation, got %q", got)
	}
	if utf8len := len([]rune(got)); utf8len > agentDescriptionMaxLen+1 {
		t.Fatalf("truncated description longer than cap: %d runes", utf8len)
	}
}

func TestDeriveAgentDescriptionReturnsEmptyForEmptyInput(t *testing.T) {
	if got := DeriveAgentDescription("   \n\n  "); got != "" {
		t.Fatalf("expected empty derive on whitespace input, got %q", got)
	}
}

func TestDeriveAgentDescriptionExtractsRoleAndResponsibility(t *testing.T) {
	instruction := "You are the Partner: the default conversation partner and orchestrator.\n\n" +
		"Your job is to help the user think clearly and route work to the right specialist.\n\n" +
		"Operating principles: …"
	got := DeriveAgentDescription(instruction)
	want := "Role: the default conversation partner and orchestrator. Responsibility: to help the user think clearly and route work to the right specialist."
	if got != want {
		t.Fatalf("derived description mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestDeriveAgentDescriptionHandlesPartialPatterns(t *testing.T) {
	roleOnly := "You are an expert coding engineer working with the user.\n\nNo job sentence here."
	if got := DeriveAgentDescription(roleOnly); got != "Role: expert coding engineer working with the user." {
		t.Fatalf("role-only derive mismatch: %q", got)
	}
	respOnly := "Some unrelated opener.\n\nYour responsibility is to ship the fix end-to-end."
	if got := DeriveAgentDescription(respOnly); got != "Responsibility: to ship the fix end-to-end." {
		t.Fatalf("responsibility-only derive mismatch: %q", got)
	}
}
