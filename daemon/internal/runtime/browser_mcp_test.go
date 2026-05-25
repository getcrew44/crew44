package runtime

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
)

// claudeMCPServer pulls the named server out of an isolated .claude.json and
// returns it as a generic map for assertions. Fails the test if the file is
// missing, unparseable, or the server is absent.
func claudeMCPServer(t *testing.T, configDir, name string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(configDir, ".claude.json"))
	if err != nil {
		t.Fatalf("read isolated .claude.json: %v", err)
	}
	var top map[string]any
	if err := json.Unmarshal(data, &top); err != nil {
		t.Fatalf("parse .claude.json: %v\ncontent=%s", err, data)
	}
	servers, ok := top["mcpServers"].(map[string]any)
	if !ok {
		t.Fatalf("expected mcpServers object, got %T (%v)", top["mcpServers"], top["mcpServers"])
	}
	server, ok := servers[name].(map[string]any)
	if !ok {
		t.Fatalf("expected mcpServers.%s object, got %T (servers=%v)", name, servers[name], servers)
	}
	return server
}

func argsContain(t *testing.T, server map[string]any, want string) bool {
	t.Helper()
	raw, ok := server["args"].([]any)
	if !ok {
		t.Fatalf("expected args array, got %T", server["args"])
	}
	for _, a := range raw {
		if s, _ := a.(string); s == want {
			return true
		}
	}
	return false
}

func TestPrepareSkillEnvironmentClaudeInjectsBrowserMCP(t *testing.T) {
	// Short-circuit OAuth so the test never reaches the macOS keychain.
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "dummy")
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "claude"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	configDir := filepath.Join(envDir, "claude-config")
	server := claudeMCPServer(t, configDir, "playwright")
	if server["command"] != "npx" {
		t.Errorf("command = %v, want npx", server["command"])
	}
	if !argsContain(t, server, playwrightMCPPackage) {
		t.Errorf("args missing %s: %v", playwrightMCPPackage, server["args"])
	}
	if !argsContain(t, server, "--headless") {
		t.Errorf("args missing --headless: %v", server["args"])
	}
	env, ok := server["env"].(map[string]any)
	if !ok {
		t.Fatalf("expected env object, got %T", server["env"])
	}
	if env["PLAYWRIGHT_BROWSERS_PATH"] != "/tmp/crew44-pw-cache" {
		t.Errorf("PLAYWRIGHT_BROWSERS_PATH = %v, want /tmp/crew44-pw-cache", env["PLAYWRIGHT_BROWSERS_PATH"])
	}
}

func TestPrepareSkillEnvironmentClaudeBrowserMCPPreservesExistingConfig(t *testing.T) {
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "dummy")
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	configDir := filepath.Join(envDir, "claude-config")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	// A realistic pre-existing .claude.json: large int timestamps (which must
	// not lose precision), an unrelated top-level key, and a user-added MCP
	// server that must survive the merge.
	const existing = `{
  "firstStartTime": 1779419133799,
  "userID": "abc123",
  "mcpServers": {
    "other": { "command": "node", "args": ["server.js"] }
  }
}`
	if err := os.WriteFile(filepath.Join(configDir, ".claude.json"), []byte(existing), 0o600); err != nil {
		t.Fatalf("seed .claude.json: %v", err)
	}

	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "claude"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	// Both servers present.
	claudeMCPServer(t, configDir, "playwright")
	if other := claudeMCPServer(t, configDir, "other"); other["command"] != "node" {
		t.Errorf("existing 'other' server clobbered: %v", other)
	}

	// Unrelated keys and the big timestamp preserved exactly (no float
	// rounding to 1.7794191e+12).
	data, _ := os.ReadFile(filepath.Join(configDir, ".claude.json"))
	if !strings.Contains(string(data), "1779419133799") {
		t.Errorf("timestamp lost precision or dropped: %s", data)
	}
	if !strings.Contains(string(data), "abc123") {
		t.Errorf("unrelated userID key dropped: %s", data)
	}
}

func TestPrepareSkillEnvironmentClaudeBrowserMCPIsIdempotent(t *testing.T) {
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "dummy")
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	req := RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "claude"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}
	for i := 0; i < 2; i++ {
		if _, err := prepareSkillEnvironment(req); err != nil {
			t.Fatalf("prepare #%d failed: %v", i, err)
		}
	}
	configDir := filepath.Join(envDir, "claude-config")
	data, err := os.ReadFile(filepath.Join(configDir, ".claude.json"))
	if err != nil {
		t.Fatalf("read .claude.json: %v", err)
	}
	var top map[string]any
	if err := json.Unmarshal(data, &top); err != nil {
		t.Fatalf("second run produced invalid JSON: %v\n%s", err, data)
	}
	servers := top["mcpServers"].(map[string]any)
	if _, ok := servers["playwright"]; !ok {
		t.Fatalf("playwright server missing after second run: %v", servers)
	}
}

func TestPrepareSkillEnvironmentCodexInjectsBrowserMCP(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "codex"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	configPath := filepath.Join(envDir, "codex-home", "config.toml")
	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read isolated codex config.toml: %v", err)
	}
	got := string(data)
	for _, want := range []string{
		"[mcp_servers.playwright]",
		`command = "npx"`,
		playwrightMCPPackage,
		"--headless",
		"[mcp_servers.playwright.env]",
		"/tmp/crew44-pw-cache",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("config.toml missing %q\n---\n%s", want, got)
		}
	}
}

func TestPrepareSkillEnvironmentCodexBrowserMCPPreservesExistingConfig(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	codexHome := filepath.Join(envDir, "codex-home")
	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		t.Fatalf("mkdir codex-home: %v", err)
	}
	// Simulate codex having written its own config.toml on a prior run.
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"), []byte("personality = \"pragmatic\"\n"), 0o600); err != nil {
		t.Fatalf("seed config.toml: %v", err)
	}

	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "codex"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(codexHome, "config.toml"))
	if err != nil {
		t.Fatalf("read config.toml: %v", err)
	}
	got := string(data)
	if !strings.Contains(got, `personality = "pragmatic"`) {
		t.Errorf("existing codex config dropped:\n%s", got)
	}
	if !strings.Contains(got, "[mcp_servers.playwright]") {
		t.Errorf("browser MCP not appended:\n%s", got)
	}
}

func TestPrepareSkillEnvironmentCodexBrowserMCPIsIdempotent(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	req := RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "codex"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}
	for i := 0; i < 2; i++ {
		if _, err := prepareSkillEnvironment(req); err != nil {
			t.Fatalf("prepare #%d failed: %v", i, err)
		}
	}
	data, err := os.ReadFile(filepath.Join(envDir, "codex-home", "config.toml"))
	if err != nil {
		t.Fatalf("read config.toml: %v", err)
	}
	if n := strings.Count(string(data), "[mcp_servers.playwright]"); n != 1 {
		t.Fatalf("expected exactly one [mcp_servers.playwright] table, got %d\n%s", n, data)
	}
}

func TestCodexHasServerTable(t *testing.T) {
	cases := []struct {
		name    string
		content string
		want    bool
	}{
		{"plain header", "[mcp_servers.playwright]\n", true},
		{"header with trailing comment", "[mcp_servers.playwright] # browser\n", true},
		{"header with inner whitespace", "[ mcp_servers.playwright ]\n", true},
		{"header with whitespace around dot", "[mcp_servers . playwright]\n", true},
		{"among other content", "personality = \"x\"\n\n[features]\nf = true\n\n[mcp_servers.playwright]\ncommand = \"npx\"\n", true},
		{"commented-out header", "# [mcp_servers.playwright]\n", false},
		{"inside string value", "note = \"see [mcp_servers.playwright] here\"\n", false},
		{"env subtable is not the table", "[mcp_servers.playwright.env]\n", false},
		{"different server", "[mcp_servers.other]\n", false},
		{"array of tables", "[[mcp_servers.playwright]]\n", false},
		{"empty", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := codexHasServerTable(tc.content, "playwright"); got != tc.want {
				t.Fatalf("codexHasServerTable(%q) = %v, want %v", tc.content, got, tc.want)
			}
		})
	}
}

// A commented-out or string-embedded mention of the table must not suppress
// injection — the real server block should still be appended.
func TestPrepareSkillEnvironmentCodexBrowserMCPIgnoresCommentedHeader(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	codexHome := filepath.Join(envDir, "codex-home")
	if err := os.MkdirAll(codexHome, 0o755); err != nil {
		t.Fatalf("mkdir codex-home: %v", err)
	}
	if err := os.WriteFile(filepath.Join(codexHome, "config.toml"),
		[]byte("# example: [mcp_servers.playwright]\nnote = \"[mcp_servers.playwright]\"\n"), 0o600); err != nil {
		t.Fatalf("seed config.toml: %v", err)
	}

	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:          model.RuntimeRecord{Provider: "codex"},
		WorkDir:          workDir,
		RuntimeEnvDir:    envDir,
		EnableBrowserMCP: true,
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(codexHome, "config.toml"))
	if err != nil {
		t.Fatalf("read config.toml: %v", err)
	}
	// The canonical block (command line) is only written by injection.
	if !strings.Contains(string(data), `command = "npx"`) {
		t.Fatalf("expected browser MCP to be injected despite commented mention:\n%s", data)
	}
}

func TestResolvePlaywrightBrowsersPathEnvOverride(t *testing.T) {
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/custom/pw")
	if got := resolvePlaywrightBrowsersPath(); got != "/custom/pw" {
		t.Fatalf("resolvePlaywrightBrowsersPath() = %q, want /custom/pw", got)
	}
}

func TestResolvePlaywrightBrowsersPathDefaultUsesHostCache(t *testing.T) {
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "")
	home := t.TempDir()
	t.Setenv("HOME", home)
	got := resolvePlaywrightBrowsersPath()
	// The exact subdir is OS-specific, but it must be an absolute path
	// anchored under the host home and end in ms-playwright.
	if !filepath.IsAbs(got) {
		t.Fatalf("expected absolute path, got %q", got)
	}
	if filepath.Base(got) != "ms-playwright" {
		t.Fatalf("expected path ending in ms-playwright, got %q", got)
	}
}

// The browser package is pinned to a specific tested version so agent behavior
// stays reproducible and a new npm publish can't change tools underneath every
// runtime. Guard against a regression back to a floating @latest tag.
func TestPlaywrightMCPPackageIsPinned(t *testing.T) {
	if strings.HasSuffix(playwrightMCPPackage, "@latest") {
		t.Fatalf("playwrightMCPPackage must be pinned to a version, got %q", playwrightMCPPackage)
	}
	at := strings.LastIndexByte(playwrightMCPPackage, '@')
	if at <= 0 || at == len(playwrightMCPPackage)-1 {
		t.Fatalf("playwrightMCPPackage must carry an explicit version (name@x.y.z), got %q", playwrightMCPPackage)
	}
}

func TestTomlStringEscapesControlChars(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"plain", "/tmp/pw", `"/tmp/pw"`},
		{"backslash", `C:\pw`, `"C:\\pw"`},
		{"double quote", `a"b`, `"a\"b"`},
		{"newline", "a\nb", `"a\nb"`},
		{"carriage return", "a\rb", `"a\rb"`},
		{"tab", "a\tb", `"a\tb"`},
		{"null byte", "a\x00b", `"a\u0000b"`},
		{"DEL", "a\x7fb", `"a\u007Fb"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tomlString(tc.in); got != tc.want {
				t.Fatalf("tomlString(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// Browser injection is opt-in. A call that leaves EnableBrowserMCP unset — like
// the chat-title summarizer, which runs on untrusted user content under
// bypass-permissions — must NOT get a playwright server in its isolated config.
func TestPrepareSkillEnvironmentClaudeOmitsBrowserMCPWhenNotEnabled(t *testing.T) {
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "dummy")
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "claude"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
		// EnableBrowserMCP intentionally omitted (false).
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(envDir, "claude-config", ".claude.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return // no config written at all is a valid "no browser" outcome
		}
		t.Fatalf("read .claude.json: %v", err)
	}
	if strings.Contains(string(data), "playwright") {
		t.Fatalf("expected no playwright server when EnableBrowserMCP is off, got: %s", data)
	}
}

func TestPrepareSkillEnvironmentCodexOmitsBrowserMCPWhenNotEnabled(t *testing.T) {
	sharedHome := t.TempDir()
	t.Setenv("CODEX_HOME", sharedHome)
	t.Setenv("PLAYWRIGHT_BROWSERS_PATH", "/tmp/crew44-pw-cache")

	workDir := t.TempDir()
	envDir := filepath.Join(t.TempDir(), "runtime-env")
	if _, err := prepareSkillEnvironment(RunRequest{
		Runtime:       model.RuntimeRecord{Provider: "codex"},
		WorkDir:       workDir,
		RuntimeEnvDir: envDir,
		// EnableBrowserMCP intentionally omitted (false).
	}); err != nil {
		t.Fatalf("prepareSkillEnvironment failed: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(envDir, "codex-home", "config.toml"))
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		t.Fatalf("read config.toml: %v", err)
	}
	if strings.Contains(string(data), "mcp_servers.playwright") {
		t.Fatalf("expected no playwright table when EnableBrowserMCP is off, got: %s", data)
	}
}
