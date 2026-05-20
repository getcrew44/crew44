package rpc

import (
	"net/http"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

// runtimes.models returns the static catalog for a known provider
// and surfaces the catalog's Default flag so the UI can pre-select it.
func TestRuntimesModelsClaudeCatalog(t *testing.T) {
	env := newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{
		Records: []model.RuntimeRecord{{
			ID:         "claude",
			Provider:   "claude",
			Name:       "Claude Code",
			Status:     model.RuntimeStatusAvailable,
			BinaryPath: "builtin://claude",
			Version:    "test",
		}},
	}, runtime.MockEngine{})
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Label   string `json:"label"`
			Default bool   `json:"default"`
		} `json:"items"`
	}
	callRPCStatus(t, env.server, "runtimes.models", map[string]any{"id": "claude"}, http.StatusOK, &resp)

	if len(resp.Items) == 0 {
		t.Fatalf("expected non-empty model catalog")
	}
	var defaults int
	var foundOpus47 bool
	for _, m := range resp.Items {
		if m.Default {
			defaults++
			if m.ID != "claude-opus-4-7" {
				t.Fatalf("expected claude default = claude-opus-4-7, got %s", m.ID)
			}
		}
		if m.ID == "claude-opus-4-7" {
			foundOpus47 = true
		}
	}
	if defaults != 1 {
		t.Fatalf("expected exactly 1 default in claude catalog, got %d", defaults)
	}
	if !foundOpus47 {
		t.Fatalf("expected catalog to contain claude-opus-4-7")
	}
}

func TestRuntimesModelsCodexCatalog(t *testing.T) {
	env := newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{
		Records: []model.RuntimeRecord{{
			ID:         "codex",
			Provider:   "codex",
			Name:       "Codex",
			Status:     model.RuntimeStatusAvailable,
			BinaryPath: "builtin://codex",
			Version:    "test",
		}},
	}, runtime.MockEngine{})
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Default bool   `json:"default"`
		} `json:"items"`
	}
	callRPCStatus(t, env.server, "runtimes.models", map[string]any{"id": "codex"}, http.StatusOK, &resp)

	var defaultID string
	for _, m := range resp.Items {
		if m.Default {
			defaultID = m.ID
		}
	}
	if defaultID != "gpt-5.5" {
		t.Fatalf("expected codex default = gpt-5.5, got %q", defaultID)
	}
}

func TestRuntimesModelsUnknownRuntimeID(t *testing.T) {
	env := newTestEnv(t)
	// Mock runtime has provider="mock" which is not in the static catalog,
	// but the runtime itself exists — so the call returns an error from
	// backendagent.ListModels rather than a not-found from the store.
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)
	callRPCStatus(t, env.server, "runtimes.models", map[string]any{"id": "does-not-exist"}, http.StatusNotFound, nil)
}
