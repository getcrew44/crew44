package rpc

import (
	"net/http"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// Switching an agent's runtime must clear the pinned model. Model IDs
// are provider-specific (gpt-5.5 vs claude-opus-4-7), so the old
// model would otherwise be passed to the new backend at execution
// time and either error out or silently misroute the request.
func TestAgentRuntimeSwitchClearsModel(t *testing.T) {
	env := newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{
		Records: []model.RuntimeRecord{
			{ID: "codex", Provider: "codex", Name: "Codex", Status: model.RuntimeStatusAvailable, BinaryPath: "builtin://codex", Version: "t"},
			{ID: "claude", Provider: "claude", Name: "Claude Code", Status: model.RuntimeStatusAvailable, BinaryPath: "builtin://claude", Version: "t"},
		},
	}, runtime.MockEngine{})
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	var created map[string]any
	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        "Switcher",
		"instruction": "be helpful",
		"runtime_id":  "codex",
		"model":       "gpt-5.5",
	}, http.StatusCreated, &created)
	agentID := created["id"].(string)

	var updated map[string]any
	callRPCStatus(t, env.server, "agents.update", map[string]any{
		"id":          agentID,
		"name":        "Switcher",
		"instruction": "be helpful",
		"runtime_id":  "claude",
		"model":       "gpt-5.5", // payload still carries stale codex model — server must clear it
	}, http.StatusOK, &updated)

	if got, _ := updated["runtime_id"].(string); got != "claude" {
		t.Fatalf("runtime_id: want claude, got %q", got)
	}
	if got, _ := updated["model"].(string); got != "" {
		t.Fatalf("model: want empty after runtime switch, got %q", got)
	}
}

// Updating instruction/name without changing runtime_id must preserve
// the pinned model — only a runtime change triggers the clear.
func TestAgentNonRuntimeUpdatePreservesModel(t *testing.T) {
	env := newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{
		Records: []model.RuntimeRecord{
			{ID: "codex", Provider: "codex", Name: "Codex", Status: model.RuntimeStatusAvailable, BinaryPath: "builtin://codex", Version: "t"},
		},
	}, runtime.MockEngine{})
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	var created map[string]any
	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        "Stable",
		"instruction": "v1",
		"runtime_id":  "codex",
		"model":       "gpt-5.4",
	}, http.StatusCreated, &created)
	agentID := created["id"].(string)

	var updated map[string]any
	callRPCStatus(t, env.server, "agents.update", map[string]any{
		"id":          agentID,
		"name":        "Stable",
		"instruction": "v2",
		"runtime_id":  "codex",
		"model":       "gpt-5.4",
	}, http.StatusOK, &updated)

	if got, _ := updated["model"].(string); got != "gpt-5.4" {
		t.Fatalf("model: want gpt-5.4 preserved, got %q", got)
	}
}
