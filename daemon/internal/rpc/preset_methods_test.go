package rpc

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
)

// preset_keys we expect to see in the default crew. Update when the manifest changes.
var defaultCrewPresetKeys = []string{"partner", "coding", "product", "designer"}

func TestPresetsBootstrapAssignsPresetMetadata(t *testing.T) {
	env := newTestEnv(t)

	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	if len(items) != len(defaultCrewPresetKeys) {
		t.Fatalf("expected %d preset agents, got %d", len(defaultCrewPresetKeys), len(items))
	}
	for _, raw := range items {
		agent, _ := raw.(map[string]any)
		if agent["preset_id"] != "default-crew" {
			t.Fatalf("agent missing preset_id metadata: %#v", agent)
		}
		if _, ok := agent["preset_key"].(string); !ok {
			t.Fatalf("agent missing preset_key metadata: %#v", agent)
		}
		skillIDs, _ := agent["skill_ids"].([]any)
		if len(skillIDs) == 0 {
			t.Fatalf("preset agent %v has no skills assigned", agent["preset_key"])
		}
	}

	// Skills should also have preset metadata.
	var skillsResp map[string]any
	callRPCStatus(t, env.server, "skills.list", nil, http.StatusOK, &skillsResp)
	skills, _ := skillsResp["items"].([]any)
	if len(skills) < 9 {
		t.Fatalf("expected >=9 preset skills, got %d", len(skills))
	}
	for _, raw := range skills {
		skill, _ := raw.(map[string]any)
		if skill["preset_id"] != "default-crew" {
			t.Fatalf("skill missing preset_id metadata: %#v", skill)
		}
		name, _ := skill["name"].(string)
		if strings.Contains(name, "/") {
			t.Fatalf("preset skill display name should not include agent prefix: %#v", skill)
		}
		presetKey, _ := skill["preset_key"].(string)
		if !strings.Contains(presetKey, "/") {
			t.Fatalf("preset skill key should preserve namespaced identity: %#v", skill)
		}
	}
}

func TestListSkillsNormalizesLegacyPresetDisplayNames(t *testing.T) {
	env := newTestEnv(t)

	registryPath := filepath.Join(env.stateDir, "skills", "registry.json")
	raw, err := os.ReadFile(registryPath)
	if err != nil {
		t.Fatalf("read skills registry: %v", err)
	}
	var records []map[string]any
	if err := json.Unmarshal(raw, &records); err != nil {
		t.Fatalf("parse skills registry: %v", err)
	}
	for i := range records {
		if records[i]["preset_key"] == "partner/problem-framing" {
			records[i]["name"] = "partner/problem-framing"
		}
	}
	updated, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		t.Fatalf("marshal skills registry: %v", err)
	}
	if err := os.WriteFile(registryPath, append(updated, '\n'), 0o644); err != nil {
		t.Fatalf("write skills registry: %v", err)
	}

	var skillsResp map[string]any
	callRPCStatus(t, env.server, "skills.list", nil, http.StatusOK, &skillsResp)
	skills, _ := skillsResp["items"].([]any)
	for _, raw := range skills {
		skill, _ := raw.(map[string]any)
		if skill["preset_key"] != "partner/problem-framing" {
			continue
		}
		if skill["name"] != "problem-framing" {
			t.Fatalf("expected normalized display name, got %#v", skill)
		}
	}
}

func TestPresetsBootstrapSkippedWithoutRuntime(t *testing.T) {
	env := newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{}, runtime.MockEngine{})
	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected no preset agents without runtime, got %d", len(items))
	}
}

func TestListPresetsReportsHasCopy(t *testing.T) {
	env := newTestEnv(t)
	var resp map[string]any
	callRPCStatus(t, env.server, "presets.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	if len(items) != len(defaultCrewPresetKeys) {
		t.Fatalf("expected %d preset entries, got %d", len(defaultCrewPresetKeys), len(items))
	}
	for _, raw := range items {
		preset, _ := raw.(map[string]any)
		if preset["has_copy"] != true {
			t.Fatalf("preset %v should report has_copy=true after bootstrap, got %#v", preset["preset_key"], preset["has_copy"])
		}
	}
}

func TestSeedDefaultCrewIsIdempotent(t *testing.T) {
	env := newTestEnv(t)
	// First explicit seed should be a no-op since bootstrap already ran.
	var first map[string]any
	callRPCStatus(t, env.server, "presets.defaultCrew.seed", nil, http.StatusOK, &first)
	if created, _ := first["created_agents"].([]any); len(created) != 0 {
		t.Fatalf("expected zero new agents on idempotent seed, got %#v", created)
	}
	if skipped, _ := first["skipped_agents"].([]any); len(skipped) != len(defaultCrewPresetKeys) {
		t.Fatalf("expected all preset agents to be skipped, got %#v", skipped)
	}
	// Calling again should remain idempotent.
	var second map[string]any
	callRPCStatus(t, env.server, "presets.defaultCrew.seed", nil, http.StatusOK, &second)
	if created, _ := second["created_agents"].([]any); len(created) != 0 {
		t.Fatalf("expected zero new agents on second seed, got %#v", created)
	}
}

func TestSeedDefaultCrewRecreatesDeletedPreset(t *testing.T) {
	env := newTestEnv(t)
	// Find a preset-backed agent and delete it via archive (no public DELETE).
	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	var targetID string
	for _, raw := range items {
		a, _ := raw.(map[string]any)
		if a["preset_key"] == "coding" {
			targetID = a["id"].(string)
			break
		}
	}
	if targetID == "" {
		t.Fatalf("coding preset agent not found in bootstrap output")
	}
	callRPCStatus(t, env.server, "agents.archive", rpcParams("id", targetID), http.StatusOK, nil)

	// After archival the agent should no longer be listed; manual seed should recreate it.
	var seedResult map[string]any
	callRPCStatus(t, env.server, "presets.defaultCrew.seed", nil, http.StatusOK, &seedResult)
	created, _ := seedResult["created_agents"].([]any)
	if len(created) != 1 || created[0] != "coding" {
		t.Fatalf("expected coding agent to be recreated, got created=%#v", created)
	}
	var after map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &after)
	afterItems, _ := after["items"].([]any)
	if len(afterItems) != len(defaultCrewPresetKeys) {
		t.Fatalf("expected %d active preset agents after re-seed, got %d", len(defaultCrewPresetKeys), len(afterItems))
	}
}

func TestPartnerPresetAgentCannotBeArchived(t *testing.T) {
	env := newTestEnv(t)

	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	var partnerID string
	for _, raw := range items {
		a, _ := raw.(map[string]any)
		if a["preset_key"] == "partner" {
			partnerID = a["id"].(string)
			break
		}
	}
	if partnerID == "" {
		t.Fatalf("partner preset agent not found in bootstrap output")
	}

	callRPCStatus(t, env.server, "agents.archive", rpcParams("id", partnerID), http.StatusBadRequest, nil)

	var after map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &after)
	afterItems, _ := after["items"].([]any)
	for _, raw := range afterItems {
		a, _ := raw.(map[string]any)
		if a["id"] == partnerID {
			return
		}
	}
	t.Fatalf("partner preset agent should still be listed after rejected archive, got %#v", after)
}

func TestSeedDefaultCrewIgnoresUserNamedAgent(t *testing.T) {
	env := newTestEnv(t)
	// Archive the preset "coding" agent so the seed has work to do.
	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	var presetCodingID string
	for _, raw := range items {
		a, _ := raw.(map[string]any)
		if a["preset_key"] == "coding" {
			presetCodingID = a["id"].(string)
			break
		}
	}
	callRPCStatus(t, env.server, "agents.archive", rpcParams("id", presetCodingID), http.StatusOK, nil)

	// User creates an unrelated agent with the same display name as the missing preset.
	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        "Coding Agent",
		"instruction": "user-owned coding agent",
		"runtime_id":  "runtime-mock",
	}, http.StatusCreated, nil)

	// Manual seed should recreate the preset coding agent (matched by preset_key, not name).
	var seedResult map[string]any
	callRPCStatus(t, env.server, "presets.defaultCrew.seed", nil, http.StatusOK, &seedResult)
	created, _ := seedResult["created_agents"].([]any)
	if len(created) != 1 || created[0] != "coding" {
		t.Fatalf("expected coding preset to be recreated despite user 'Coding Agent', got created=%#v", created)
	}
}

func TestResetAgentPresetRestoresFactoryFields(t *testing.T) {
	env := newTestEnv(t)
	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	var partnerID string
	for _, raw := range items {
		a, _ := raw.(map[string]any)
		if a["preset_key"] == "partner" {
			partnerID = a["id"].(string)
			break
		}
	}
	if partnerID == "" {
		t.Fatalf("partner preset agent not found")
	}

	// User edits the agent.
	callRPCStatus(t, env.server, "agents.update", withRPCParam(t, map[string]any{
		"name":        "Edited Partner",
		"instruction": "edited instruction",
	}, "id", partnerID), http.StatusOK, nil)

	// Reset the agent.
	var resetResp map[string]any
	callRPCStatus(t, env.server, "agents.preset.reset", rpcParams("id", partnerID), http.StatusOK, &resetResp)
	if agents, _ := resetResp["reset_agents"].([]any); len(agents) != 1 || agents[0] != "partner" {
		t.Fatalf("expected reset_agents=[partner], got %#v", resetResp)
	}

	// Confirm fields were restored.
	var after map[string]any
	callRPCStatus(t, env.server, "agents.get", rpcParams("id", partnerID), http.StatusOK, &after)
	if after["name"] != "Partner" {
		t.Fatalf("expected name to be restored to 'Partner', got %#v", after["name"])
	}
	if instr, _ := after["instruction"].(string); instr == "edited instruction" || instr == "" {
		t.Fatalf("expected instruction to be restored from factory, got %#v", instr)
	}
}

func TestResetAgentPresetRejectsNonPresetAgent(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)
	agentID := createAgent(t, env, "Aria")
	callRPCStatus(t, env.server, "agents.preset.reset", rpcParams("id", agentID), http.StatusBadRequest, nil)
}

func TestSeedDefaultCrewConcurrentCallsNoDuplicates(t *testing.T) {
	// newTestEnv bootstraps the preset crew already, so concurrent seed calls
	// should both observe full state and report zero new creations.
	env := newTestEnv(t)

	var wg sync.WaitGroup
	wg.Add(4)
	results := make(chan int, 4)
	for i := 0; i < 4; i++ {
		go func() {
			defer wg.Done()
			callRPCStatus(t, env.server, "presets.defaultCrew.seed", nil, http.StatusOK, nil)
			results <- http.StatusOK
		}()
	}
	wg.Wait()
	close(results)
	for code := range results {
		if code != http.StatusOK {
			t.Fatalf("concurrent seed: unexpected status %d", code)
		}
	}

	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	if len(items) != len(defaultCrewPresetKeys) {
		t.Fatalf("concurrent seed produced wrong agent count: %d (want %d)", len(items), len(defaultCrewPresetKeys))
	}
}
