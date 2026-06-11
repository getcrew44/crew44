package runtime

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	backendagent "github.com/getcrew44/crew44/daemon/internal/backendagent"
	"github.com/getcrew44/crew44/daemon/internal/model"
)

type LocalScanner struct{}

type providerSpec struct {
	Provider   string
	PathEnv    string
	ModelEnv   string
	DefaultBin string
}

var localProviderSpecs = []providerSpec{
	{Provider: "claude", PathEnv: "CREW44_CLAUDE_PATH", ModelEnv: "CREW44_CLAUDE_MODEL", DefaultBin: "claude"},
	{Provider: "codex", PathEnv: "CREW44_CODEX_PATH", ModelEnv: "CREW44_CODEX_MODEL", DefaultBin: "codex"},
	{Provider: "cursor", PathEnv: "CREW44_CURSOR_PATH", ModelEnv: "CREW44_CURSOR_MODEL", DefaultBin: "cursor-agent"},
	{Provider: "gemini", PathEnv: "CREW44_GEMINI_PATH", ModelEnv: "CREW44_GEMINI_MODEL", DefaultBin: "gemini"},
	{Provider: "hermes", PathEnv: "CREW44_HERMES_PATH", ModelEnv: "CREW44_HERMES_MODEL", DefaultBin: "hermes"},
	{Provider: "kimi", PathEnv: "CREW44_KIMI_PATH", ModelEnv: "CREW44_KIMI_MODEL", DefaultBin: "kimi"},
	{Provider: "opencode", PathEnv: "CREW44_OPENCODE_PATH", ModelEnv: "CREW44_OPENCODE_MODEL", DefaultBin: "opencode"},
	{Provider: "openclaw", PathEnv: "CREW44_OPENCLAW_PATH", ModelEnv: "CREW44_OPENCLAW_MODEL", DefaultBin: "openclaw"},
	{Provider: "pi", PathEnv: "CREW44_PI_PATH", ModelEnv: "CREW44_PI_MODEL", DefaultBin: "pi"},
	{Provider: "qoder", PathEnv: "CREW44_QODER_PATH", ModelEnv: "CREW44_QODER_MODEL", DefaultBin: "qodercli"},
	{Provider: "qwen", PathEnv: "CREW44_QWEN_PATH", ModelEnv: "CREW44_QWEN_MODEL", DefaultBin: "qwen"},
}

func (LocalScanner) Scan(ctx context.Context) ([]model.RuntimeRecord, error) {
	refreshSystemPath()
	now := time.Now().UTC()
	records := make([]model.RuntimeRecord, 0, len(localProviderSpecs))
	debug := daemonDebugEnabled()
	runtimeScanDebugf(debug, "start providers=%d PATH=%q", len(localProviderSpecs), os.Getenv("PATH"))
	for _, spec := range localProviderSpecs {
		bin, source := runtimePathCandidate(spec)
		runtimeScanDebugf(debug, "provider=%s candidate=%q source=%s", spec.Provider, bin, source)
		resolved, err := exec.LookPath(bin)
		if err != nil {
			runtimeScanDebugf(debug, "provider=%s look_path=failed error=%q", spec.Provider, err.Error())
			continue
		}
		runtimeScanDebugf(debug, "provider=%s look_path=ok resolved=%q", spec.Provider, resolved)
		version, err := backendagent.DetectVersion(ctx, resolved)
		if err != nil {
			runtimeScanDebugf(debug, "provider=%s version=failed error=%q", spec.Provider, err.Error())
			continue
		}
		runtimeScanDebugf(debug, "provider=%s version=ok detected=%q", spec.Provider, version)
		if err := backendagent.CheckMinVersion(spec.Provider, version); err != nil {
			runtimeScanDebugf(debug, "provider=%s min_version=failed error=%q", spec.Provider, err.Error())
			continue
		}
		modelName := strings.TrimSpace(os.Getenv(spec.ModelEnv))
		record := model.RuntimeRecord{
			ID:         spec.Provider,
			Provider:   spec.Provider,
			Name:       displayRuntimeName(spec.Provider),
			Status:     model.RuntimeStatusAvailable,
			BinaryPath: resolved,
			Version:    version,
			DetectedAt: now,
			Metadata: map[string]any{
				"model": modelName,
			},
		}
		records = append(records, record)
		runtimeScanDebugf(debug, "provider=%s available binary=%q version=%q model_set=%t", spec.Provider, resolved, version, modelName != "")
	}
	runtimeScanDebugf(debug, "done found=%d", len(records))
	return records, nil
}

func runtimePathCandidate(spec providerSpec) (string, string) {
	if value := strings.TrimSpace(os.Getenv(spec.PathEnv)); value != "" {
		return value, spec.PathEnv
	}
	return spec.DefaultBin, "default"
}

func daemonDebugEnabled() bool {
	for _, name := range []string{"daemon_debug", "DAEMON_DEBUG", "CREW44_DAEMON_DEBUG"} {
		if envTruthy(os.Getenv(name)) {
			return true
		}
	}
	return false
}

func envTruthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "0", "false", "no", "off":
		return false
	default:
		return true
	}
}

func runtimeScanDebugf(enabled bool, format string, args ...any) {
	if !enabled {
		return
	}
	fmt.Fprintf(os.Stderr, "daemon_debug runtime_scan "+format+"\n", args...)
}

func displayRuntimeName(provider string) string {
	switch provider {
	case "claude":
		return "Claude Code"
	case "codex":
		return "Codex"
	case "cursor":
		return "Cursor Agent"
	case "gemini":
		return "Gemini CLI"
	case "hermes":
		return "Hermes"
	case "kimi":
		return "Kimi"
	case "opencode":
		return "OpenCode"
	case "openclaw":
		return "OpenClaw"
	case "pi":
		return "Pi"
	case "qoder":
		return "Qoder"
	case "qwen":
		return "Qwen Code"
	default:
		return strings.Title(provider)
	}
}
