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

const skillManifestFile = ".crew44-skill-manifest.json"

var nonAlphaNum = regexp.MustCompile(`[^a-z0-9]+`)

type preparedSkillEnvironment struct {
	Env       map[string]string
	ExtraArgs []string
}

func prepareSkillEnvironment(request RunRequest) (preparedSkillEnvironment, error) {
	if len(request.AgentSkills) == 0 && request.Runtime.Provider != "claude" && request.Runtime.Provider != "codex" {
		return preparedSkillEnvironment{}, nil
	}
	if strings.TrimSpace(request.WorkDir) == "" {
		return preparedSkillEnvironment{}, fmt.Errorf("runtime skill injection requires a workdir")
	}

	switch request.Runtime.Provider {
	case "claude":
		runtimeEnvDir := strings.TrimSpace(request.RuntimeEnvDir)
		if runtimeEnvDir == "" {
			return preparedSkillEnvironment{}, fmt.Errorf("claude skill injection requires a runtime env dir")
		}
		claudeConfigDir := filepath.Join(runtimeEnvDir, "claude-config")
		homeDir := filepath.Join(runtimeEnvDir, "home")
		if err := os.MkdirAll(claudeConfigDir, 0o755); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("create claude config dir: %w", err)
		}
		if err := os.MkdirAll(homeDir, 0o755); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("create claude home dir: %w", err)
		}
		if err := prepareClaudeConfig(claudeConfigDir); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("prepare claude config: %w", err)
		}
		if err := writeSkillFiles(filepath.Join(claudeConfigDir, "skills"), request.AgentSkills); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("write claude skills: %w", err)
		}
		env := map[string]string{
			"CLAUDE_CONFIG_DIR": claudeConfigDir,
			"HOME":              homeDir,
		}
		// Inject the host OAuth credential so the spawned claude reuses the
		// host login. The refresh token + scopes let claude exchange an
		// expired access token for a fresh one mid-session — without them
		// the 12h access-token TTL turns the spawned claude into a 401 the
		// next morning.
		cred := readClaudeOAuthCredential()
		if cred.AccessToken != "" {
			env["CLAUDE_CODE_OAUTH_TOKEN"] = cred.AccessToken
		}
		// CLAUDE_CODE_OAUTH_REFRESH_TOKEN must be paired with
		// CLAUDE_CODE_OAUTH_SCOPES per the env-vars docs — injecting one
		// without the other is a broken auth env that claude can't use.
		if cred.RefreshToken != "" && cred.Scopes != "" {
			env["CLAUDE_CODE_OAUTH_REFRESH_TOKEN"] = cred.RefreshToken
			env["CLAUDE_CODE_OAUTH_SCOPES"] = cred.Scopes
		}
		// Anywhere we hand claude an OAuth credential, also turn on the
		// documented subprocess env scrub so claude strips those vars
		// before spawning the Bash tool, hooks, or MCP stdio servers.
		// The refresh token is long-lived and high-impact if it leaks
		// into a child shell's environment.
		if cred.AccessToken != "" || cred.RefreshToken != "" {
			env["CLAUDE_CODE_SUBPROCESS_ENV_SCRUB"] = "1"
		}
		return preparedSkillEnvironment{
			Env:       env,
			ExtraArgs: []string{"--setting-sources", "user"},
		}, nil
	case "codex":
		runtimeEnvDir := strings.TrimSpace(request.RuntimeEnvDir)
		if runtimeEnvDir == "" {
			return preparedSkillEnvironment{}, fmt.Errorf("codex skill injection requires a runtime env dir")
		}
		codexHome := filepath.Join(request.RuntimeEnvDir, "codex-home")
		homeDir := filepath.Join(request.RuntimeEnvDir, "home")
		if err := os.MkdirAll(homeDir, 0o755); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("create codex home dir: %w", err)
		}
		if err := prepareCodexHome(codexHome); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("prepare codex home: %w", err)
		}
		if err := clearSkillDirs(filepath.Join(codexHome, "skills"), request.AgentSkills); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("clear codex skill shadows: %w", err)
		}
		if err := writeSkillFiles(filepath.Join(codexHome, "skills"), request.AgentSkills); err != nil {
			return preparedSkillEnvironment{}, fmt.Errorf("write codex skills: %w", err)
		}
		return preparedSkillEnvironment{Env: map[string]string{"CODEX_HOME": codexHome, "HOME": homeDir}}, nil
	}

	skillsDir, err := resolveSkillsDir(request.WorkDir, request.Runtime.Provider)
	if err != nil {
		return preparedSkillEnvironment{}, fmt.Errorf("resolve skills dir: %w", err)
	}
	if err := writeSkillFiles(skillsDir, request.AgentSkills); err != nil {
		return preparedSkillEnvironment{}, fmt.Errorf("write skill files: %w", err)
	}
	return preparedSkillEnvironment{}, nil
}

func clearSkillDirs(skillsDir string, skills []SkillContext) error {
	for _, skill := range skills {
		if err := os.RemoveAll(filepath.Join(skillsDir, sanitizeSkillName(skill.Name))); err != nil {
			return err
		}
	}
	return nil
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
				return fmt.Errorf("skill directory %q already exists and is not managed by Crew44", dir)
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
