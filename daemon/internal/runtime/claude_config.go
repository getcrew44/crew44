package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type claudeSettings struct {
	Env map[string]string `json:"env,omitempty"`
}

func prepareClaudeConfig(configDir string) error {
	settings, ok, err := readSharedClaudeSettings()
	if err != nil {
		return err
	}
	if !ok || len(settings.Env) == 0 {
		return nil
	}

	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return fmt.Errorf("create claude config dir: %w", err)
	}
	data, err := json.MarshalIndent(claudeSettings{Env: settings.Env}, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal claude settings: %w", err)
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(configDir, "settings.json"), data, 0o600)
}

func readSharedClaudeSettings() (claudeSettings, bool, error) {
	path := filepath.Join(resolveSharedClaudeConfigDir(), "settings.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return claudeSettings{}, false, nil
	}
	if err != nil {
		return claudeSettings{}, false, fmt.Errorf("read claude settings: %w", err)
	}

	var settings claudeSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return claudeSettings{}, false, fmt.Errorf("parse claude settings: %w", err)
	}
	return settings, true, nil
}

// readClaudeOAuthToken returns the user's Claude Code access token from the
// platform-appropriate credential store so the spawned (isolated) claude CLI
// can authenticate without prompting `/login` again. Returns "" if no
// credential is found — claude will surface its own "Not logged in" message
// and the user can run `/login` once. The override CLAUDE_CODE_OAUTH_TOKEN in
// the daemon process is honored first, mainly for tests.
func readClaudeOAuthToken() string {
	if v := os.Getenv("CLAUDE_CODE_OAUTH_TOKEN"); v != "" {
		return v
	}
	switch runtime.GOOS {
	case "darwin":
		return readClaudeOAuthTokenFromKeychain()
	default:
		return readClaudeOAuthTokenFromFile()
	}
}

// readClaudeOAuthTokenFromKeychain reads the OAuth blob claude stored in the
// macOS login keychain under the "Claude Code-credentials" service and
// extracts the active access token. Failures (no entry, locked keychain,
// malformed payload) are treated as "no token" — the caller falls back to
// letting claude print its own login prompt.
func readClaudeOAuthTokenFromKeychain() string {
	cmd := exec.Command("security", "find-generic-password", "-s", "Claude Code-credentials", "-w")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	var payload struct {
		ClaudeAiOauth struct {
			AccessToken string `json:"accessToken"`
		} `json:"claudeAiOauth"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return ""
	}
	return payload.ClaudeAiOauth.AccessToken
}

// readClaudeOAuthTokenFromFile reads the access token from the file-based
// credential store that claude uses on Linux/Windows. The file lives at
// <CLAUDE_CONFIG_DIR>/.credentials.json with the same JSON shape as the macOS
// keychain blob.
func readClaudeOAuthTokenFromFile() string {
	path := filepath.Join(resolveSharedClaudeConfigDir(), ".credentials.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var payload struct {
		ClaudeAiOauth struct {
			AccessToken string `json:"accessToken"`
		} `json:"claudeAiOauth"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return ""
	}
	return payload.ClaudeAiOauth.AccessToken
}

func resolveSharedClaudeConfigDir() string {
	if v := os.Getenv("CLAUDE_CONFIG_DIR"); v != "" {
		if abs, err := filepath.Abs(v); err == nil {
			return abs
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(os.TempDir(), ".claude")
	}
	return filepath.Join(home, ".claude")
}
