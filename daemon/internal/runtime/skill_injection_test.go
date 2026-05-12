package runtime

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

func TestPrepareSkillEnvironmentWritesProviderNativeSkills(t *testing.T) {
	workDir := t.TempDir()

	env, err := prepareSkillEnvironment(RunRequest{
		Runtime: model.RuntimeRecord{Provider: "cursor"},
		WorkDir: workDir,
		AgentSkills: []SkillContext{{
			ID:      "skill-1",
			Name:    "Review Helper!",
			Content: "# Review Helper\nUse this skill.\n",
			Files: []SkillFileContext{{
				Path:    "references/checklist.md",
				Content: "- Check edge cases\n",
			}},
		}},
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	if len(env) != 0 {
		t.Fatalf("expected no provider env for cursor, got %#v", env)
	}

	assertFileContains(t, filepath.Join(workDir, ".cursor", "skills", "review-helper", "SKILL.md"), "Use this skill")
	assertFileContains(t, filepath.Join(workDir, ".cursor", "skills", "review-helper", "references", "checklist.md"), "edge cases")
	assertFileContains(t, filepath.Join(workDir, ".cursor", "skills", skillManifestFile), "review-helper")
}

func TestPrepareSkillEnvironmentPrunesManagedStaleSkills(t *testing.T) {
	workDir := t.TempDir()
	first := RunRequest{
		Runtime: model.RuntimeRecord{Provider: "claude"},
		WorkDir: workDir,
		AgentSkills: []SkillContext{{
			ID:      "skill-1",
			Name:    "One",
			Content: "# One\n",
		}},
	}
	if _, err := prepareSkillEnvironment(first); err != nil {
		t.Fatalf("first prepare failed: %v", err)
	}
	second := first
	second.AgentSkills = []SkillContext{{
		ID:      "skill-2",
		Name:    "Two",
		Content: "# Two\n",
	}}
	if _, err := prepareSkillEnvironment(second); err != nil {
		t.Fatalf("second prepare failed: %v", err)
	}

	if _, err := os.Stat(filepath.Join(workDir, ".claude", "skills", "one")); !os.IsNotExist(err) {
		t.Fatalf("expected stale skill directory to be removed, stat err=%v", err)
	}
	assertFileContains(t, filepath.Join(workDir, ".claude", "skills", "two", "SKILL.md"), "# Two")
}

func TestPrepareSkillEnvironmentCodexUsesIsolatedHome(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	if err := os.WriteFile(filepath.Join(sharedHome, "auth.json"), []byte(`{"token":"ok"}`), 0o600); err != nil {
		t.Fatalf("write auth: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedHome, "config.toml"), []byte("[profile]\nname = \"default\"\n\n[[skills.config]]\nname = \"plugin-only\"\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	env, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "codex"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
		AgentSkills: []SkillContext{{
			ID:      "skill-1",
			Name:    "Codex Skill",
			Content: "# Codex Skill\n",
		}},
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	codexHome := filepath.Join(envDir, "codex-home")
	if env["CODEX_HOME"] != codexHome {
		t.Fatalf("expected CODEX_HOME %q, got %#v", codexHome, env)
	}
	assertFileContains(t, filepath.Join(codexHome, "skills", "codex-skill", "SKILL.md"), "# Codex Skill")
	configBytes, err := os.ReadFile(filepath.Join(codexHome, "config.toml"))
	if err != nil {
		t.Fatalf("read copied config: %v", err)
	}
	if strings.Contains(string(configBytes), "[[skills.config]]") {
		t.Fatalf("expected inherited skills.config blocks stripped, got %q", string(configBytes))
	}
}

func TestAppendSkillSummary(t *testing.T) {
	got := appendSkillSummary("Base instruction", "claude", []SkillContext{{Name: "Review Helper"}})
	if !strings.Contains(got, "Base instruction") || !strings.Contains(got, "Review Helper") {
		t.Fatalf("summary missing content: %q", got)
	}
}

func assertFileContains(t *testing.T, path, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !strings.Contains(string(data), want) {
		t.Fatalf("%s: expected %q in %q", path, want, string(data))
	}
}
