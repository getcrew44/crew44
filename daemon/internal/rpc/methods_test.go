package rpc

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

func TestResourceLifecyclePersistsExpectedFiles(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	var agent map[string]any
	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        "Aria",
		"instruction": "You are helpful",
		"runtime_id":  "runtime-mock",
		"model":       "mock-1",
	}, http.StatusCreated, &agent)

	var skill map[string]any
	callRPCStatus(t, env.server, "skills.create", map[string]any{
		"name": "Core Skill",
	}, http.StatusCreated, &skill)

	callRPCStatus(t, env.server, "agents.skills.replace", withRPCParam(t, map[string]any{
		"skill_ids": []string{skill["id"].(string)},
	}, "id", agent["id"]), http.StatusOK, nil)

	var project map[string]any
	callRPCStatus(t, env.server, "projects.create", map[string]any{
		"name":          "Demo Project",
		"workdir":       "/tmp/demo-project",
		"main_agent_id": agent["id"],
	}, http.StatusCreated, &project)

	var chat map[string]any
	callRPCStatus(t, env.server, "chats.create", map[string]any{
		"project_id":    project["id"],
		"title":         "Demo Chat",
		"main_agent_id": agent["id"],
	}, http.StatusCreated, &chat)

	assertFileExists(t, filepath.Join(env.stateDir, "runtimes.json"))
	assertFileExists(t, filepath.Join(env.stateDir, "agents", "agent-"+agent["id"].(string), "config.json"))
	assertFileExists(t, filepath.Join(env.stateDir, "skills", "registry.json"))
	assertFileExists(t, filepath.Join(env.stateDir, "skills", "skill-"+skill["id"].(string), "SKILL.md"))
	assertFileExists(t, filepath.Join(env.stateDir, "projects", "registry.jsonl"))
	assertFileExists(t, filepath.Join(env.stateDir, "projects", "proj-"+project["id"].(string), "project.json"))
	assertFileExists(t, filepath.Join(env.stateDir, "projects", "proj-"+project["id"].(string), "chats.jsonl"))
	assertFileExists(t, filepath.Join(env.stateDir, "chats", "chat-"+chat["id"].(string), "chat.json"))
	assertFileExists(t, filepath.Join(env.stateDir, "chats", "chat-"+chat["id"].(string), "events.jsonl"))
	assertFileExists(t, filepath.Join(env.stateDir, "chats", "chat-"+chat["id"].(string), "summary.md"))
}

func TestBootstrapCreatesDefaultCrewWhenRuntimeExists(t *testing.T) {
	env := newTestEnv(t)

	var agents map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &agents)
	items, _ := agents["items"].([]any)
	if len(items) != 4 {
		t.Fatalf("expected four preset agents from default-crew bootstrap, got %d: %#v", len(items), agents)
	}

	wantKeys := map[string]bool{"partner": false, "coding": false, "product": false, "designer": false}
	for _, raw := range items {
		agent, _ := raw.(map[string]any)
		if agent["runtime_id"] != "runtime-mock" {
			t.Fatalf("expected preset agent to use runtime-mock, got %#v", agent["runtime_id"])
		}
		if agent["preset_id"] != "default-crew" {
			t.Fatalf("expected preset_id=default-crew on bootstrapped agent, got %#v", agent["preset_id"])
		}
		key, _ := agent["preset_key"].(string)
		if _, ok := wantKeys[key]; !ok {
			t.Fatalf("unexpected preset_key %q in bootstrapped crew", key)
		}
		wantKeys[key] = true
	}
	for key, seen := range wantKeys {
		if !seen {
			t.Fatalf("missing preset agent with key %q in bootstrapped crew", key)
		}
	}
}

func TestBootstrapSkipsDefaultAgentWhenNoRuntimeExists(t *testing.T) {
	env := newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{}, runtime.MockEngine{})

	var agents map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &agents)
	items, _ := agents["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected no bootstrapped agents without runtimes, got %#v", agents)
	}
}

func TestArchivedAgentsAreHiddenFromList(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Temporary Agent")
	callRPCStatus(t, env.server, "agents.archive", rpcParams("id", agentID), http.StatusOK, nil)

	var agents map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &agents)
	items, _ := agents["items"].([]any)
	for _, item := range items {
		agent, _ := item.(map[string]any)
		if agent["id"] == agentID {
			t.Fatalf("archived agent should be hidden from agents.list, got %#v", agents)
		}
	}
}

func TestOnboardingStatusPersistsInAppState(t *testing.T) {
	env := newTestEnv(t)

	var status map[string]any
	callRPCStatus(t, env.server, "onboarding.get", nil, http.StatusOK, &status)
	if status["onboarding_required"] != true {
		t.Fatalf("expected onboarding to be required initially, got %#v", status)
	}
	if status["last_onboarding_version"] != "" {
		t.Fatalf("expected empty initial onboarding version, got %#v", status["last_onboarding_version"])
	}

	callRPCStatus(t, env.server, "onboarding.complete", nil, http.StatusOK, &status)
	if status["onboarding_required"] != false {
		t.Fatalf("expected onboarding to be complete, got %#v", status)
	}
	if status["last_onboarding_version"] == "" {
		t.Fatalf("expected non-empty onboarding version after completion, got %#v", status)
	}

	raw, err := os.ReadFile(filepath.Join(env.stateDir, "app.json"))
	if err != nil {
		t.Fatalf("read app.json: %v", err)
	}
	if !strings.Contains(string(raw), `"last_onboarding_version"`) {
		t.Fatalf("expected app.json to store last_onboarding_version, got %s", raw)
	}

	restarted := newServerForState(t, env.stateDir, env.scanner)
	callRPCStatus(t, restarted, "onboarding.get", nil, http.StatusOK, &status)
	if status["onboarding_required"] != false {
		t.Fatalf("expected completed onboarding to survive restart, got %#v", status)
	}
}

func TestCorruptAppStateDoesNotRequireOnboarding(t *testing.T) {
	env := newTestEnv(t)
	if err := os.WriteFile(filepath.Join(env.stateDir, "app.json"), []byte("{not-json"), 0o644); err != nil {
		t.Fatalf("write corrupt app.json: %v", err)
	}

	var status map[string]any
	callRPCStatus(t, env.server, "onboarding.get", nil, http.StatusOK, &status)
	if status["onboarding_required"] != false {
		t.Fatalf("expected corrupt app state to be treated as already onboarded, got %#v", status)
	}
	if status["last_onboarding_version"] == "" {
		t.Fatalf("expected non-empty onboarding version for corrupt app state, got %#v", status)
	}

	callRPCStatus(t, env.server, "onboarding.complete", nil, http.StatusOK, &status)
	if status["onboarding_required"] != false {
		t.Fatalf("expected complete to overwrite corrupt app state, got %#v", status)
	}
	raw, err := os.ReadFile(filepath.Join(env.stateDir, "app.json"))
	if err != nil {
		t.Fatalf("read repaired app.json: %v", err)
	}
	if !json.Valid(raw) {
		t.Fatalf("expected complete to rewrite valid app.json, got %s", raw)
	}
}

func TestCreateProjectRequiresNonEmptyWorkdir(t *testing.T) {
	env := newTestEnv(t)

	callRPCStatus(t, env.server, "projects.create", map[string]any{
		"name":          "Empty Workdir Project",
		"workdir":       "",
		"main_agent_id": "",
	}, http.StatusBadRequest, nil)
}

func TestCreateProjectRequiresMainAgentID(t *testing.T) {
	env := newTestEnv(t)

	callRPCStatus(t, env.server, "projects.create", map[string]any{
		"name":          "No Agent Project",
		"workdir":       "/tmp/no-agent-project",
		"main_agent_id": "",
	}, http.StatusBadRequest, nil)
}

func TestCreateProjectRequiresRunnableMainAgent(t *testing.T) {
	env := newTestEnv(t)
	agentID := defaultAgentID(t, env)

	env.scanner.Records = nil
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	callRPCStatus(t, env.server, "projects.create", map[string]any{
		"name":          "Missing Runtime Project",
		"workdir":       "/tmp/missing-runtime-project",
		"main_agent_id": agentID,
	}, http.StatusBadRequest, nil)
}

func TestCreateAgentRequiresRuntimeID(t *testing.T) {
	env := newTestEnv(t)

	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        "No Runtime Agent",
		"instruction": "You are helpful",
		"runtime_id":  "",
		"model":       "mock-1",
	}, http.StatusBadRequest, nil)
}

func TestCreateChatRequiresRunnableMainAgentAndExistingProject(t *testing.T) {
	env := newTestEnv(t)
	defaultAgentID := defaultAgentID(t, env)
	projectID := createProject(t, env, defaultAgentID)

	callRPCStatus(t, env.server, "chats.create", map[string]any{
		"project_id":    projectID,
		"title":         "No Main Agent Chat",
		"main_agent_id": "",
	}, http.StatusBadRequest, nil)

	callRPCStatus(t, env.server, "chats.create", map[string]any{
		"project_id":    "missing-project",
		"title":         "Missing Project Chat",
		"main_agent_id": defaultAgentID,
	}, http.StatusNotFound, nil)

	env.scanner.Records = nil
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	callRPCStatus(t, env.server, "chats.create", map[string]any{
		"project_id":    projectID,
		"title":         "Missing Runtime Chat",
		"main_agent_id": defaultAgentID,
	}, http.StatusBadRequest, nil)
}

func TestUpdateAgentRejectsUnavailableRuntime(t *testing.T) {
	env := newTestEnv(t)
	agentID := createAgent(t, env, "Aria")

	env.scanner.Records = nil
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	callRPCStatus(t, env.server, "agents.update", withRPCParam(t, map[string]any{
		"runtime_id": "runtime-mock",
	}, "id", agentID), http.StatusBadRequest, nil)
}

func TestUpdateProjectRejectsUnavailableMainAgent(t *testing.T) {
	env := newTestEnv(t)
	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)

	env.scanner.Records = nil
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	callRPCStatus(t, env.server, "projects.update", withRPCParam(t, map[string]any{
		"main_agent_id": agentID,
	}, "id", projectID), http.StatusBadRequest, nil)
}

func TestRestartReloadsPersistedResources(t *testing.T) {
	env := newTestEnv(t)
	callRPCStatus(t, env.server, "runtimes.rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")

	var skill map[string]any
	callRPCStatus(t, env.server, "skills.create", map[string]any{
		"name": "Core Skill",
	}, http.StatusCreated, &skill)
	callRPCStatus(t, env.server, "agents.skills.replace", withRPCParam(t, map[string]any{
		"skill_ids": []string{skill["id"].(string)},
	}, "id", agentID), http.StatusOK, nil)

	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	restarted := newServerForState(t, env.stateDir, env.scanner)

	var agents map[string]any
	callRPCStatus(t, restarted, "agents.list", nil, http.StatusOK, &agents)
	if items, _ := agents["items"].([]any); len(items) != 5 {
		t.Fatalf("expected 5 agents after restart (4 preset + 1 created), got %#v", agents)
	}

	var projects map[string]any
	callRPCStatus(t, restarted, "projects.list", nil, http.StatusOK, &projects)
	if items, _ := projects["items"].([]any); len(items) != 1 {
		t.Fatalf("expected 1 project after restart, got %#v", projects)
	}

	var chats map[string]any
	callRPCStatus(t, restarted, "chats.list", nil, http.StatusOK, &chats)
	items, _ := chats["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 chat after restart, got %#v", chats)
	}
	record, _ := items[0].(map[string]any)
	if record["id"] != chatID {
		t.Fatalf("expected restarted chat list to include %s, got %#v", chatID, record["id"])
	}

	var chat map[string]any
	callRPCStatus(t, restarted, "chats.get", rpcParams("id", chatID), http.StatusOK, &chat)
	if chat["project_id"] != projectID {
		t.Fatalf("expected chat project_id %s after restart, got %#v", projectID, chat["project_id"])
	}
}
