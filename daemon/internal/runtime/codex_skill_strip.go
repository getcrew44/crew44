package runtime

import (
	"fmt"
	"os"
	"strings"
)

func stripSkillsConfigEntries(content string) string {
	if !strings.Contains(content, "[[skills.config]]") {
		return content
	}

	lines := strings.Split(content, "\n")
	out := make([]string, 0, len(lines))
	inSkillsConfig := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[") {
			if trimmed == "[[skills.config]]" {
				inSkillsConfig = true
				continue
			}
			inSkillsConfig = false
			out = append(out, line)
			continue
		}
		if inSkillsConfig {
			continue
		}
		out = append(out, line)
	}

	stripped := strings.TrimRight(strings.Join(out, "\n"), "\n") + "\n"
	if strings.TrimSpace(stripped) == "" {
		return ""
	}
	return stripped
}

func sanitizeCopiedCodexConfig(configPath string) error {
	data, err := os.ReadFile(configPath)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read config.toml: %w", err)
	}
	stripped := stripSkillsConfigEntries(string(data))
	if stripped == string(data) {
		return nil
	}
	if err := os.WriteFile(configPath, []byte(stripped), 0o644); err != nil {
		return fmt.Errorf("write config.toml: %w", err)
	}
	return nil
}
