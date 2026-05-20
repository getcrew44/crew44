package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

type claudeSettings struct {
	Env map[string]envValue `json:"env,omitempty"`
}

// envValue accepts string, number, boolean, and null JSON scalars and
// normalizes them to their textual form. Claude Code's own settings
// parser tolerates non-string scalars (e.g. `"API_TIMEOUT_MS": 3000000`)
// since env vars are strings at the OS level anyway — rejecting them
// here would refuse otherwise-valid host settings.
type envValue string

func (e *envValue) UnmarshalJSON(data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("empty env value")
	}
	switch data[0] {
	case '"':
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		*e = envValue(s)
		return nil
	case '{', '[':
		return fmt.Errorf("env value must be a scalar, got %s", data)
	case 'n': // null
		*e = ""
		return nil
	default:
		// Numbers (3000000, -1.5) and booleans (true/false): the raw
		// JSON literal is already the string form an env var expects.
		*e = envValue(data)
		return nil
	}
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

// claudeOAuthCredential holds the env-var-injectable subset of the host's
// Claude Code OAuth credential. Any field may be empty.
type claudeOAuthCredential struct {
	AccessToken  string
	RefreshToken string
	Scopes       string // space-separated, ready for CLAUDE_CODE_OAUTH_SCOPES
}

// readClaudeOAuthCredential pulls the Claude Code OAuth credential from the
// parent process environment first, then the platform credential store.
// The spawned (isolated) claude runs with a redirected HOME and
// CLAUDE_CONFIG_DIR, so it cannot see the host keychain (ACL-gated for
// non-GUI processes) or .credentials.json on its own. crew44 has to
// re-supply the credential — especially because backendagent/claude.go
// strips every CLAUDE_CODE_* var from the parent env before launching
// the child, so anything the user explicitly set there would otherwise
// vanish.
//
// We inject three env vars from the resulting credential:
//
//   - CLAUDE_CODE_OAUTH_TOKEN         (accessToken, 12h TTL)
//   - CLAUDE_CODE_OAUTH_REFRESH_TOKEN (long-lived refreshToken)
//   - CLAUDE_CODE_OAUTH_SCOPES        (space-separated)
//
// With refreshToken + scopes set, claude can swap an expired accessToken
// for a fresh one without a browser — the documented "automated
// environments" path. The refresh-token / scopes pair is atomic per the
// env-vars docs; injecting one without the other is a broken auth env.
//
// Precedence:
//
//  1. Parent-env override — anything the user explicitly set wins, both
//     so tests/CI can pin a deterministic credential and so the
//     documented automation pattern (refresh + scopes only) works.
//     CLAUDE_CODE_OAUTH_TOKEN and the refresh/scopes pair are honored
//     independently; a partial pair (only refresh, only scopes) is
//     ignored and falls through.
//  2. Platform credential store — keychain on macOS, .credentials.json
//     elsewhere.
func readClaudeOAuthCredential() claudeOAuthCredential {
	var fromEnv claudeOAuthCredential
	if v := os.Getenv("CLAUDE_CODE_OAUTH_TOKEN"); v != "" {
		fromEnv.AccessToken = v
	}
	if r, s := os.Getenv("CLAUDE_CODE_OAUTH_REFRESH_TOKEN"), os.Getenv("CLAUDE_CODE_OAUTH_SCOPES"); r != "" && s != "" {
		fromEnv.RefreshToken = r
		fromEnv.Scopes = s
	}
	if fromEnv.AccessToken != "" || fromEnv.RefreshToken != "" {
		return fromEnv
	}

	var blob []byte
	var ok bool
	switch runtime.GOOS {
	case "darwin":
		blob, ok = readClaudeOAuthBlobFromKeychain()
	default:
		blob, ok = readClaudeOAuthBlobFromFile()
	}
	if !ok {
		return claudeOAuthCredential{}
	}
	return parseClaudeOAuthCredential(blob)
}

// parseClaudeOAuthCredential parses the JSON blob claude stores in the
// platform credential store and returns the env-var-injectable fields.
// Pure function — no I/O, no platform dependency — so the parsing logic
// can be covered by fixture-based tests on every OS.
//
// Invariant: if the returned RefreshToken is non-empty, Scopes is also
// non-empty. Per the env-vars docs, CLAUDE_CODE_OAUTH_REFRESH_TOKEN
// requires CLAUDE_CODE_OAUTH_SCOPES — without scopes the refresh token
// is unusable, so we treat them as an atomic pair and zero both out
// rather than ever emit a broken half.
func parseClaudeOAuthCredential(blob []byte) claudeOAuthCredential {
	var payload struct {
		ClaudeAiOauth struct {
			AccessToken  string   `json:"accessToken"`
			RefreshToken string   `json:"refreshToken"`
			Scopes       []string `json:"scopes"`
		} `json:"claudeAiOauth"`
	}
	if err := json.Unmarshal(blob, &payload); err != nil {
		return claudeOAuthCredential{}
	}
	o := payload.ClaudeAiOauth
	cred := claudeOAuthCredential{AccessToken: o.AccessToken}
	scopes := strings.Join(o.Scopes, " ")
	if o.RefreshToken != "" && scopes != "" {
		cred.RefreshToken = o.RefreshToken
		cred.Scopes = scopes
	}
	return cred
}

// readClaudeOAuthBlobFromKeychain returns the raw JSON blob claude stored
// in the macOS login keychain entry "Claude Code-credentials". Failures
// (no entry, locked keychain) are treated as "no credential" — the caller
// lets claude print its own login prompt.
func readClaudeOAuthBlobFromKeychain() ([]byte, bool) {
	cmd := exec.Command("security", "find-generic-password", "-s", "Claude Code-credentials", "-w")
	out, err := cmd.Output()
	if err != nil {
		return nil, false
	}
	return out, true
}

// readClaudeOAuthBlobFromFile returns the raw JSON blob from the
// file-based credential store claude uses on Linux/Windows. The file
// lives at <CLAUDE_CONFIG_DIR>/.credentials.json with the same JSON shape
// as the macOS keychain blob.
func readClaudeOAuthBlobFromFile() ([]byte, bool) {
	path := filepath.Join(resolveSharedClaudeConfigDir(), ".credentials.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	return data, true
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
