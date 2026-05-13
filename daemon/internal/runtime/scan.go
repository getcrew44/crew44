package runtime

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	backendagent "github.com/sqtech/crew-ai/crewai-repo/internal/backendagent"
	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
)

type LocalScanner struct{}

type providerSpec struct {
	Provider    string
	PathEnv     string
	LegacyEnv   string
	ModelEnv    string
	LegacyModel string
	DefaultBin  string
}

var localProviderSpecs = []providerSpec{
	{
		Provider:    "claude",
		PathEnv:     "CREWAI_CLAUDE_PATH",
		LegacyEnv:   "MULTICA_CLAUDE_PATH",
		ModelEnv:    "CREWAI_CLAUDE_MODEL",
		LegacyModel: "MULTICA_CLAUDE_MODEL",
		DefaultBin:  "claude",
	},
	{
		Provider:    "codex",
		PathEnv:     "CREWAI_CODEX_PATH",
		LegacyEnv:   "MULTICA_CODEX_PATH",
		ModelEnv:    "CREWAI_CODEX_MODEL",
		LegacyModel: "MULTICA_CODEX_MODEL",
		DefaultBin:  "codex",
	},
}

func (LocalScanner) Scan(ctx context.Context) ([]model.RuntimeRecord, error) {
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
		modelName := firstNonEmpty(
			strings.TrimSpace(os.Getenv(spec.ModelEnv)),
			strings.TrimSpace(os.Getenv(spec.LegacyModel)),
		)
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
	if value := strings.TrimSpace(os.Getenv(spec.LegacyEnv)); value != "" {
		return value, spec.LegacyEnv
	}
	return spec.DefaultBin, "default"
}

func daemonDebugEnabled() bool {
	for _, name := range []string{"daemon_debug", "DAEMON_DEBUG", "CREWAI_DAEMON_DEBUG"} {
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
	default:
		return strings.Title(provider)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
