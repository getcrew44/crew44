package runtime

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

func TestPrepareSkillEnvironmentWritesProviderNativeSkills(t *testing.T) {
	workDir := t.TempDir()

	preparedEnv, err := prepareSkillEnvironment(RunRequest{
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
	if len(preparedEnv.Env) != 0 || len(preparedEnv.ExtraArgs) != 0 {
		t.Fatalf("expected no provider env for cursor, got %#v", preparedEnv)
	}

	assertFileContains(t, filepath.Join(workDir, ".cursor", "skills", "review-helper", "SKILL.md"), "Use this skill")
	assertFileContains(t, filepath.Join(workDir, ".cursor", "skills", "review-helper", "references", "checklist.md"), "edge cases")
	assertFileContains(t, filepath.Join(workDir, ".cursor", "skills", skillManifestFile), "review-helper")
}

func TestPrepareSkillEnvironmentPrunesManagedStaleSkills(t *testing.T) {
	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	first := RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "claude"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
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

	claudeSkills := filepath.Join(envDir, "claude-config", "skills")
	if _, err := os.Stat(filepath.Join(workDir, ".claude")); !os.IsNotExist(err) {
		t.Fatalf("expected workspace .claude directory to be absent, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(claudeSkills, "one")); !os.IsNotExist(err) {
		t.Fatalf("expected stale skill directory to be removed, stat err=%v", err)
	}
	assertFileContains(t, filepath.Join(claudeSkills, "two", "SKILL.md"), "# Two")
}

func TestPrepareSkillEnvironmentClaudeUsesIsolatedConfigDir(t *testing.T) {
	sharedClaudeConfig := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", sharedClaudeConfig)
	if err := os.WriteFile(
		filepath.Join(sharedClaudeConfig, "settings.json"),
		[]byte(`{"env":{"ANTHROPIC_AUTH_TOKEN":"token","ANTHROPIC_BASE_URL":"https://example.test"},"permissions":{"allow":["Bash(*)"]}}`),
		0o600,
	); err != nil {
		t.Fatalf("write shared claude settings: %v", err)
	}

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	preparedEnv, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "claude"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
		AgentSkills: []SkillContext{{
			ID:      "skill-1",
			Name:    "Claude Skill",
			Content: "# Claude Skill\n",
		}},
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	if preparedEnv.Env["CLAUDE_CONFIG_DIR"] != filepath.Join(envDir, "claude-config") {
		t.Fatalf("expected isolated CLAUDE_CONFIG_DIR, got %#v", preparedEnv.Env)
	}
	if preparedEnv.Env["HOME"] != filepath.Join(envDir, "home") {
		t.Fatalf("expected isolated HOME, got %#v", preparedEnv.Env)
	}
	if got := strings.Join(preparedEnv.ExtraArgs, "\x00"); got != "--setting-sources\x00user" {
		t.Fatalf("expected claude isolation args, got %#v", preparedEnv.ExtraArgs)
	}
	settingsPath := filepath.Join(envDir, "claude-config", "settings.json")
	assertFileContains(t, settingsPath, "ANTHROPIC_AUTH_TOKEN")
	assertFileContains(t, settingsPath, "ANTHROPIC_BASE_URL")
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		t.Fatalf("read isolated claude settings: %v", err)
	}
	if strings.Contains(string(data), "permissions") || strings.Contains(string(data), "Bash(*)") {
		t.Fatalf("expected only claude settings env to be copied, got %s", data)
	}
	assertFileContains(t, filepath.Join(envDir, "claude-config", "skills", "claude-skill", "SKILL.md"), "# Claude Skill")
}

func TestPrepareSkillEnvironmentClaudeIsolatesEvenWithoutSkills(t *testing.T) {
	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	preparedEnv, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "claude"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	if preparedEnv.Env["CLAUDE_CONFIG_DIR"] != filepath.Join(envDir, "claude-config") {
		t.Fatalf("expected isolated CLAUDE_CONFIG_DIR, got %#v", preparedEnv.Env)
	}
	if preparedEnv.Env["HOME"] != filepath.Join(envDir, "home") {
		t.Fatalf("expected isolated HOME, got %#v", preparedEnv.Env)
	}
	if got := strings.Join(preparedEnv.ExtraArgs, "\x00"); got != "--setting-sources\x00user" {
		t.Fatalf("expected claude isolation args, got %#v", preparedEnv.ExtraArgs)
	}
}

func TestPrepareSkillEnvironmentClaudeInjectsOAuthToken(t *testing.T) {
	// The spawned claude runs in a fully isolated HOME + CLAUDE_CONFIG_DIR, so
	// it cannot see the user's keychain entry or .credentials.json file on its
	// own. The daemon reads the host's token up front and hands it to claude
	// via CLAUDE_CODE_OAUTH_TOKEN so login is reused without exposing any
	// shared state directory.
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "host-token-xyz")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	preparedEnv, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "claude"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	if got := preparedEnv.Env["CLAUDE_CODE_OAUTH_TOKEN"]; got != "host-token-xyz" {
		t.Fatalf("expected CLAUDE_CODE_OAUTH_TOKEN to be injected, got %q", got)
	}
	if preparedEnv.Env["HOME"] != filepath.Join(envDir, "home") {
		t.Fatalf("expected isolated HOME, got %#v", preparedEnv.Env)
	}
	if preparedEnv.Env["CLAUDE_CONFIG_DIR"] != filepath.Join(envDir, "claude-config") {
		t.Fatalf("expected isolated CLAUDE_CONFIG_DIR, got %#v", preparedEnv.Env)
	}
}

func TestPrepareSkillEnvironmentClaudeInjectsRefreshTokenAndScopes(t *testing.T) {
	// When a Claude Code credential blob is available on the host, crew44
	// hands the spawned (isolated) claude not just the access token but
	// also the refresh token and scopes — claude needs all three to
	// exchange an expired access token for a fresh one without a browser.
	// Without that, the 12h access-token TTL would 401 the next session.
	//
	// Skip on darwin: the credential store there is the macOS keychain,
	// which prepareSkillEnvironment reads via `security` — we must not
	// touch the developer's real Claude credentials from a unit test. The
	// pure-function path (parseClaudeOAuthCredential) gives parity
	// coverage on every OS.
	if runtime.GOOS == "darwin" {
		t.Skip("file-based credential store path is linux/windows only")
	}
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "")
	sharedDir := t.TempDir()
	t.Setenv("CLAUDE_CONFIG_DIR", sharedDir)
	blob := `{"claudeAiOauth":{"accessToken":"access-abc","refreshToken":"refresh-xyz","scopes":["user:profile","user:inference"]}}`
	if err := os.WriteFile(filepath.Join(sharedDir, ".credentials.json"), []byte(blob), 0o600); err != nil {
		t.Fatalf("write credentials: %v", err)
	}

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	preparedEnv, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "claude"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	if got := preparedEnv.Env["CLAUDE_CODE_OAUTH_TOKEN"]; got != "access-abc" {
		t.Fatalf("CLAUDE_CODE_OAUTH_TOKEN = %q, want access-abc", got)
	}
	if got := preparedEnv.Env["CLAUDE_CODE_OAUTH_REFRESH_TOKEN"]; got != "refresh-xyz" {
		t.Fatalf("CLAUDE_CODE_OAUTH_REFRESH_TOKEN = %q, want refresh-xyz", got)
	}
	if got := preparedEnv.Env["CLAUDE_CODE_OAUTH_SCOPES"]; got != "user:profile user:inference" {
		t.Fatalf("CLAUDE_CODE_OAUTH_SCOPES = %q, want %q", got, "user:profile user:inference")
	}
	if got := preparedEnv.Env["CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"]; got != "1" {
		t.Fatalf("CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = %q, want 1 (scrub credentials from claude's bash/hook/MCP subprocesses)", got)
	}
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
	sharedSkillsDir := filepath.Join(sharedHome, "skills")
	if err := os.MkdirAll(filepath.Join(sharedSkillsDir, "shared-skill"), 0o755); err != nil {
		t.Fatalf("mkdir shared skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedSkillsDir, "shared-skill", "SKILL.md"), []byte("# Shared Skill\n"), 0o644); err != nil {
		t.Fatalf("write shared skill: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(sharedSkillsDir, "codex-skill"), 0o755); err != nil {
		t.Fatalf("mkdir shadowed skill: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedSkillsDir, "codex-skill", "SKILL.md"), []byte("# Shadowed Shared Skill\n"), 0o644); err != nil {
		t.Fatalf("write shadowed skill: %v", err)
	}

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	preparedEnv, err := prepareSkillEnvironment(RunRequest{
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
	if preparedEnv.Env["CODEX_HOME"] != codexHome {
		t.Fatalf("expected CODEX_HOME %q, got %#v", codexHome, preparedEnv.Env)
	}
	if preparedEnv.Env["HOME"] != filepath.Join(envDir, "home") {
		t.Fatalf("expected isolated HOME, got %#v", preparedEnv.Env)
	}
	if len(preparedEnv.ExtraArgs) != 0 {
		t.Fatalf("expected no codex extra args, got %#v", preparedEnv.ExtraArgs)
	}
	assertFileContains(t, filepath.Join(codexHome, "skills", "codex-skill", "SKILL.md"), "# Codex Skill")
	if _, err := os.Stat(filepath.Join(codexHome, "skills", "shared-skill")); !os.IsNotExist(err) {
		t.Fatalf("expected shared codex skill to be hidden, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(codexHome, "config.toml")); !os.IsNotExist(err) {
		t.Fatalf("expected shared codex config to be hidden, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(codexHome, "auth.json")); err != nil {
		t.Fatalf("expected auth state to be available, stat err=%v", err)
	}
}

func TestPrepareSkillEnvironmentCodexIsolatesEvenWithoutSkills(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	if err := os.WriteFile(filepath.Join(sharedHome, "auth.json"), []byte(`{"token":"ok"}`), 0o600); err != nil {
		t.Fatalf("write auth: %v", err)
	}
	if err := os.WriteFile(filepath.Join(sharedHome, "config.toml"), []byte("model = \"from-user-config\"\n"), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	preparedEnv, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "codex"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
	})
	if err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}
	codexHome := filepath.Join(envDir, "codex-home")
	if preparedEnv.Env["CODEX_HOME"] != codexHome {
		t.Fatalf("expected isolated CODEX_HOME, got %#v", preparedEnv.Env)
	}
	if preparedEnv.Env["HOME"] != filepath.Join(envDir, "home") {
		t.Fatalf("expected isolated HOME, got %#v", preparedEnv.Env)
	}
	if _, err := os.Stat(filepath.Join(codexHome, "auth.json")); err != nil {
		t.Fatalf("expected auth state to be available, stat err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(codexHome, "config.toml")); !os.IsNotExist(err) {
		t.Fatalf("expected shared codex config to be hidden, stat err=%v", err)
	}
}

func TestPrepareSkillEnvironmentCodexReplacesManagedSkills(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	first := RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "codex"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
		AgentSkills: []SkillContext{{
			ID:      "skill-1",
			Name:    "Other",
			Content: "# Other\n",
		}},
	}
	if _, err := prepareSkillEnvironment(first); err != nil {
		t.Fatalf("first prepare failed: %v", err)
	}
	codexHome := filepath.Join(envDir, "codex-home")
	assertFileContains(t, filepath.Join(codexHome, "skills", "other", "SKILL.md"), "# Other")

	second := first
	second.AgentSkills = []SkillContext{{
		ID:      "skill-2",
		Name:    "Codex Skill",
		Content: "# Crew44 Codex Skill\n",
	}}
	if _, err := prepareSkillEnvironment(second); err != nil {
		t.Fatalf("second prepare failed: %v", err)
	}
	assertFileContains(t, filepath.Join(codexHome, "skills", "codex-skill", "SKILL.md"), "# Crew44 Codex Skill")
	if _, err := os.Stat(filepath.Join(codexHome, "skills", "other")); !os.IsNotExist(err) {
		t.Fatalf("expected stale managed skill to be removed, stat err=%v", err)
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
