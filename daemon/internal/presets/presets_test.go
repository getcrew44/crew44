package presets

import (
	"reflect"
	"strings"
	"testing"
)

func TestDefaultCrewCodingAgentUsesExpectedPresetSkills(t *testing.T) {
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		t.Fatalf("load default crew manifest: %v", err)
	}

	var coding ManifestAgent
	for _, agent := range manifest.Agents {
		if agent.PresetKey == "coding" {
			coding = agent
			break
		}
	}
	if coding.PresetKey == "" {
		t.Fatalf("coding preset agent not found")
	}

	want := []string{
		"coding/brainstorming",
		"coding/executing-plans",
		"coding/finishing-a-development-branch",
		"coding/receiving-code-review",
		"coding/requesting-code-review",
		"coding/systematic-debugging",
		"coding/test-driven-development",
		"coding/using-git-worktrees",
		"coding/verification-before-completion",
		"coding/writing-plans",
		"coding/writing-skills",
	}
	if !reflect.DeepEqual(coding.SkillRefs, want) {
		t.Fatalf("coding skill refs mismatch\nwant: %#v\n got: %#v", want, coding.SkillRefs)
	}

	for _, ref := range want {
		files, err := readEmbeddedSkillFiles(ref)
		if err != nil {
			t.Fatalf("read embedded skill %q: %v", ref, err)
		}
		if files["SKILL.md"] == "" {
			t.Fatalf("skill %q has empty SKILL.md", ref)
		}
	}
}

func TestDefaultCrewCodingAgentInstructionIncludesCrewAIContextAndSkills(t *testing.T) {
	manifest, err := LoadDefaultCrewManifest()
	if err != nil {
		t.Fatalf("load default crew manifest: %v", err)
	}

	var coding ManifestAgent
	for _, agent := range manifest.Agents {
		if agent.PresetKey == "coding" {
			coding = agent
			break
		}
	}
	if coding.PresetKey == "" {
		t.Fatalf("coding preset agent not found")
	}

	instruction, err := readEmbeddedInstruction(coding)
	if err != nil {
		t.Fatalf("read coding instruction: %v", err)
	}

	required := []string{
		"CrewAI Desktop",
		"local-first",
		"daemon/",
		"src/",
		"electron/",
		"~/.crewai",
		"agents",
		"skills",
		"runtimes",
		"chats",
		"Available skills",
		"brainstorming",
		"systematic-debugging",
		"test-driven-development",
		"verification-before-completion",
		"writing-plans",
	}
	for _, want := range required {
		if !strings.Contains(instruction, want) {
			t.Fatalf("coding instruction missing %q\ninstruction:\n%s", want, instruction)
		}
	}
}
