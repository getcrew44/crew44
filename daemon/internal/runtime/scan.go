package runtime

import (
	"context"
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
	for _, spec := range localProviderSpecs {
		bin := firstNonEmpty(
			strings.TrimSpace(os.Getenv(spec.PathEnv)),
			strings.TrimSpace(os.Getenv(spec.LegacyEnv)),
			spec.DefaultBin,
		)
		resolved, err := exec.LookPath(bin)
		if err != nil {
			continue
		}
		version, err := backendagent.DetectVersion(ctx, resolved)
		if err != nil {
			continue
		}
		if err := backendagent.CheckMinVersion(spec.Provider, version); err != nil {
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
	}
	return records, nil
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
