package runtime

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const skillManifestFile = ".crewai-skill-manifest.json"

var nonAlphaNum = regexp.MustCompile(`[^a-z0-9]+`)

func prepareSkillEnvironment(request RunRequest) (map[string]string, error) {
	if len(request.AgentSkills) == 0 {
		return nil, nil
	}
	if strings.TrimSpace(request.WorkDir) == "" {
		return nil, fmt.Errorf("runtime skill injection requires a workdir")
	}

	if request.Runtime.Provider == "codex" {
		codexHome := filepath.Join(request.RuntimeEnvDir, "codex-home")
		if codexHome == "codex-home" {
			codexHome = filepath.Join(request.WorkDir, ".crewai-runtime", "codex-home")
		}
		if err := prepareCodexHome(codexHome); err != nil {
			return nil, fmt.Errorf("prepare codex home: %w", err)
		}
		if err := writeSkillFiles(filepath.Join(codexHome, "skills"), request.AgentSkills); err != nil {
			return nil, fmt.Errorf("write codex skills: %w", err)
		}
		return map[string]string{"CODEX_HOME": codexHome}, nil
	}

	skillsDir, err := resolveSkillsDir(request.WorkDir, request.Runtime.Provider)
	if err != nil {
		return nil, fmt.Errorf("resolve skills dir: %w", err)
	}
	if err := writeSkillFiles(skillsDir, request.AgentSkills); err != nil {
		return nil, fmt.Errorf("write skill files: %w", err)
	}
	return nil, nil
}

func appendSkillSummary(systemPrompt, provider string, skills []SkillContext) string {
	if len(skills) == 0 {
		return systemPrompt
	}

	var b strings.Builder
	b.WriteString(strings.TrimSpace(systemPrompt))
	if b.Len() > 0 {
		b.WriteString("\n\n")
	}
	b.WriteString("Available skills:\n")
	switch provider {
	case "gemini", "hermes":
		b.WriteString("Detailed skill instructions are in `.agent_context/skills/`. Each subdirectory contains a `SKILL.md`.\n")
	default:
		b.WriteString("The following skills are installed in the runtime's native skill location and should be used when relevant.\n")
	}
	for _, skill := range skills {
		fmt.Fprintf(&b, "- %s\n", skill.Name)
	}
	return strings.TrimSpace(b.String())
}

func resolveSkillsDir(workDir, provider string) (string, error) {
	var skillsDir string
	switch provider {
	case "claude":
		skillsDir = filepath.Join(workDir, ".claude", "skills")
	case "copilot":
		skillsDir = filepath.Join(workDir, ".github", "skills")
	case "opencode":
		skillsDir = filepath.Join(workDir, ".config", "opencode", "skills")
	case "openclaw":
		skillsDir = filepath.Join(workDir, ".openclaw", "skills")
	case "pi":
		skillsDir = filepath.Join(workDir, ".pi", "skills")
	case "cursor":
		skillsDir = filepath.Join(workDir, ".cursor", "skills")
	case "kimi":
		skillsDir = filepath.Join(workDir, ".kimi", "skills")
	case "kiro":
		skillsDir = filepath.Join(workDir, ".kiro", "skills")
	default:
		skillsDir = filepath.Join(workDir, ".agent_context", "skills")
	}
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return "", err
	}
	return skillsDir, nil
}

func sanitizeSkillName(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = nonAlphaNum.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "skill"
	}
	return s
}

func writeSkillFiles(skillsDir string, skills []SkillContext) error {
	if err := os.MkdirAll(skillsDir, 0o755); err != nil {
		return fmt.Errorf("create skills dir: %w", err)
	}

	previous, err := readSkillManifest(skillsDir)
	if err != nil {
		return err
	}
	next := make(map[string]struct{}, len(skills))
	for _, skill := range skills {
		dirName := sanitizeSkillName(skill.Name)
		next[dirName] = struct{}{}
		dir := filepath.Join(skillsDir, dirName)
		if _, owned := previous[dirName]; owned {
			if err := os.RemoveAll(dir); err != nil {
				return err
			}
		} else {
			if exists, err := pathExists(dir); err != nil {
				return err
			} else if exists {
				return fmt.Errorf("skill directory %q already exists and is not managed by CrewAI", dir)
			}
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(skill.Content), 0o644); err != nil {
			return err
		}
		for _, file := range skill.Files {
			path, err := safeSkillFilePath(dir, file.Path)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(path, []byte(file.Content), 0o644); err != nil {
				return err
			}
		}
	}

	for dirName := range previous {
		if _, keep := next[dirName]; keep {
			continue
		}
		if err := os.RemoveAll(filepath.Join(skillsDir, dirName)); err != nil {
			return err
		}
	}
	return writeSkillManifest(skillsDir, next)
}

func safeSkillFilePath(root, name string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(strings.TrimSpace(name)))
	if cleaned == "." || filepath.IsAbs(cleaned) || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) || cleaned == ".." {
		return "", fmt.Errorf("invalid skill file path %q", name)
	}
	return filepath.Join(root, cleaned), nil
}

func readSkillManifest(skillsDir string) (map[string]struct{}, error) {
	data, err := os.ReadFile(filepath.Join(skillsDir, skillManifestFile))
	if os.IsNotExist(err) {
		return map[string]struct{}{}, nil
	}
	if err != nil {
		return nil, err
	}
	var names []string
	if err := json.Unmarshal(data, &names); err != nil {
		return nil, fmt.Errorf("read skill manifest: %w", err)
	}
	out := make(map[string]struct{}, len(names))
	for _, name := range names {
		out[name] = struct{}{}
	}
	return out, nil
}

func writeSkillManifest(skillsDir string, names map[string]struct{}) error {
	list := make([]string, 0, len(names))
	for name := range names {
		list = append(list, name)
	}
	sort.Strings(list)
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(skillsDir, skillManifestFile), data, 0o644)
}

func pathExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}
