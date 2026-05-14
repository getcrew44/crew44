package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
