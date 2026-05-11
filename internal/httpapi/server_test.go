package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sqtech/crew-ai/crewai-repo/internal/model"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
)

func TestResourceLifecyclePersistsExpectedFiles(t *testing.T) {
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	var agent map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/agents", map[string]any{
		"name":        "Aria",
		"instruction": "You are helpful",
		"runtime_id":  "runtime-mock",
		"model":       "mock-1",
	}, http.StatusCreated, &agent)

	var skill map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/skills", map[string]any{
		"name": "Core Skill",
	}, http.StatusCreated, &skill)

	postJSON(t, env.server, http.MethodPut, fmt.Sprintf("/api/agents/%s/skills", agent["id"]), map[string]any{
		"skill_ids": []string{skill["id"].(string)},
	}, http.StatusOK, nil)

	var project map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/projects", map[string]any{
		"name":          "Demo Project",
		"workdir":       "/tmp/demo-project",
		"main_agent_id": agent["id"],
	}, http.StatusCreated, &project)

	var chat map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/chat/sessions", map[string]any{
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

func TestChatMessageReplayAndFollowSSE(t *testing.T) {
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "/slow /tool please review",
		"target_agent_id": agentID,
	}, http.StatusAccepted, nil)

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/chat/sessions/%s/events?after=0&follow=1", chatID), nil)
	req.Header.Set("Accept", "text/event-stream")
	rec := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		env.server.ServeHTTP(rec, req)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for SSE stream to finish")
	}

	body := rec.Body.String()
	if !strings.Contains(body, "event: chat.event") {
		t.Fatalf("expected chat.event entries, got %q", body)
	}
	if !strings.Contains(body, "\"type\":\"tool_call\"") {
		t.Fatalf("expected tool_call payload in replay/follow stream, got %q", body)
	}
	if !strings.Contains(body, "event: done") {
		t.Fatalf("expected done event in SSE stream, got %q", body)
	}

	var replay map[string]any
	getJSON(t, env.server, fmt.Sprintf("/api/chat/sessions/%s/events?after=0", chatID), http.StatusOK, &replay)
	items, _ := replay["events"].([]any)
	if len(items) < 4 {
		t.Fatalf("expected replay events, got %#v", replay)
	}
}

func TestChatSwitchAgentRebuildsSummaryAndSupportsHandoff(t *testing.T) {
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "first pass",
		"target_agent_id": agentA,
	}, http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         fmt.Sprintf("/tool /handoff:%s second pass", agentB),
		"target_agent_id": agentA,
	}, http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	summaryPath := filepath.Join(env.stateDir, "chats", "chat-"+chatID, "summary.md")
	summaryBytes, err := os.ReadFile(summaryPath)
	if err != nil {
		t.Fatalf("read summary: %v", err)
	}
	summary := string(summaryBytes)
	if !strings.Contains(summary, "first pass") {
		t.Fatalf("summary should contain earlier user message, got %q", summary)
	}
	if strings.Contains(summary, "<CREWAI_HANDOFF>") {
		t.Fatalf("summary should not keep handoff marker, got %q", summary)
	}

	var chat map[string]any
	getJSON(t, env.server, fmt.Sprintf("/api/chat/sessions/%s", chatID), http.StatusOK, &chat)
	if chat["current_agent_id"] != agentB {
		t.Fatalf("expected handoff to update current agent to %s, got %#v", agentB, chat["current_agent_id"])
	}
}

func TestRejectsConcurrentMessagesAndMissingRuntime(t *testing.T) {
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "/slow hold",
		"target_agent_id": agentID,
	}, http.StatusAccepted, nil)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "should conflict",
		"target_agent_id": agentID,
	}, http.StatusConflict, nil)

	waitForChatIdle(t, env.server, chatID)

	env.scanner.Records = nil
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "should fail because runtime is missing",
		"target_agent_id": agentID,
	}, http.StatusConflict, nil)
}

func TestHandoffToCurrentAgentStopsLoop(t *testing.T) {
	engine := &loopingHandoffEngine{}
	env := newTestEnvWithEngine(t, engine)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	agentA := createAgent(t, env, "Aria")
	agentB := createAgent(t, env, "Bex")
	engine.targetID = agentB
	projectID := createProject(t, env, agentA)
	chatID := createChat(t, env, projectID, agentA)

	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "trigger handoff loop guard",
		"target_agent_id": agentA,
	}, http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	var replay map[string]any
	getJSON(t, env.server, fmt.Sprintf("/api/chat/sessions/%s/events?after=0", chatID), http.StatusOK, &replay)
	items, _ := replay["events"].([]any)
	if len(items) != 3 {
		t.Fatalf("expected loop guard to stop after one self-handoff, got %#v", replay)
	}

	var chat map[string]any
	getJSON(t, env.server, fmt.Sprintf("/api/chat/sessions/%s", chatID), http.StatusOK, &chat)
	if chat["current_agent_id"] != agentB {
		t.Fatalf("expected current agent to remain on handoff target %s, got %#v", agentB, chat["current_agent_id"])
	}
}

func TestListChatsWithoutProjectFilterReturnsAllChats(t *testing.T) {
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")
	projectA := createProject(t, env, agentID)
	projectB := createProject(t, env, agentID)
	chatA := createChat(t, env, projectA, agentID)
	chatB := createChat(t, env, projectB, agentID)

	var resp map[string]any
	getJSON(t, env.server, "/api/chat/sessions", http.StatusOK, &resp)

	items, _ := resp["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 chats from unfiltered list, got %#v", resp)
	}

	seen := map[string]bool{}
	for _, item := range items {
		record, _ := item.(map[string]any)
		seen[record["id"].(string)] = true
	}
	if !seen[chatA] || !seen[chatB] {
		t.Fatalf("expected both chats in unfiltered list, got %#v", resp)
	}
}

func TestRestartReloadsPersistedResources(t *testing.T) {
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)

	agentID := createAgent(t, env, "Aria")

	var skill map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/skills", map[string]any{
		"name": "Core Skill",
	}, http.StatusCreated, &skill)
	postJSON(t, env.server, http.MethodPut, fmt.Sprintf("/api/agents/%s/skills", agentID), map[string]any{
		"skill_ids": []string{skill["id"].(string)},
	}, http.StatusOK, nil)

	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)

	restarted := newServerForState(t, env.stateDir, env.scanner)

	var agents map[string]any
	getJSON(t, restarted, "/api/agents", http.StatusOK, &agents)
	if items, _ := agents["items"].([]any); len(items) != 1 {
		t.Fatalf("expected 1 agent after restart, got %#v", agents)
	}

	var projects map[string]any
	getJSON(t, restarted, "/api/projects", http.StatusOK, &projects)
	if items, _ := projects["items"].([]any); len(items) != 1 {
		t.Fatalf("expected 1 project after restart, got %#v", projects)
	}

	var chats map[string]any
	getJSON(t, restarted, "/api/chat/sessions", http.StatusOK, &chats)
	items, _ := chats["items"].([]any)
	if len(items) != 1 {
		t.Fatalf("expected 1 chat after restart, got %#v", chats)
	}
	record, _ := items[0].(map[string]any)
	if record["id"] != chatID {
		t.Fatalf("expected restarted chat list to include %s, got %#v", chatID, record["id"])
	}

	var chat map[string]any
	getJSON(t, restarted, fmt.Sprintf("/api/chat/sessions/%s", chatID), http.StatusOK, &chat)
	if chat["project_id"] != projectID {
		t.Fatalf("expected chat project_id %s after restart, got %#v", projectID, chat["project_id"])
	}
}

type testEnv struct {
	server         http.Handler
	stateDir       string
	runtimeScanDir string
	scanner        *runtime.StaticScanner
}

func newTestEnv(t *testing.T) testEnv {
	return newTestEnvWithEngine(t, runtime.MockEngine{})
}

func newTestEnvWithEngine(t *testing.T, engine runtime.Engine) testEnv {
	t.Helper()

	root := t.TempDir()
	stateDir := filepath.Join(root, ".crewai")
	runtimeScanDir := filepath.Join(root, "runtime-manifests")
	if err := os.MkdirAll(runtimeScanDir, 0o755); err != nil {
		t.Fatalf("mkdir runtime scan dir: %v", err)
	}

	scanner := &runtime.StaticScanner{
		Records: []model.RuntimeRecord{mockRuntimeRecord()},
	}

	app, err := NewServer(ServerConfig{
		StateDir:       stateDir,
		RuntimeScanDir: runtimeScanDir,
		Scanner:        scanner,
		Engine:         engine,
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}

	return testEnv{
		server:         app,
		stateDir:       stateDir,
		runtimeScanDir: runtimeScanDir,
		scanner:        scanner,
	}
}

type loopingHandoffEngine struct {
	targetID string
}

func (e *loopingHandoffEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	var content string
	switch request.Agent.Name {
	case "Aria":
		content = "handoff to Bex ^<CREWAI_HANDOFF>" + e.targetID + "</CREWAI_HANDOFF>"
	default:
		content = "repeat handoff ^<CREWAI_HANDOFF>" + request.Agent.ID + "</CREWAI_HANDOFF>"
	}
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: content,
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	return runtime.RunResult{SessionID: "loop-guard"}, nil
}

func newServerForState(t *testing.T, stateDir string, scanner runtime.Scanner) http.Handler {
	t.Helper()

	server, err := NewServer(ServerConfig{
		StateDir:       stateDir,
		RuntimeScanDir: filepath.Join(filepath.Dir(stateDir), "runtime-manifests"),
		Scanner:        scanner,
		Engine:         runtime.MockEngine{},
	})
	if err != nil {
		t.Fatalf("new server for existing state: %v", err)
	}
	return server
}

func mockRuntimeRecord() model.RuntimeRecord {
	return model.RuntimeRecord{
		ID:         "runtime-mock",
		Provider:   "mock",
		Name:       "Mock Runtime",
		Status:     model.RuntimeStatusAvailable,
		BinaryPath: "builtin://mock",
		Version:    "test",
	}
}

func createAgent(t *testing.T, env testEnv, name string) string {
	t.Helper()

	var resp map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/agents", map[string]any{
		"name":        name,
		"instruction": "Be helpful",
		"runtime_id":  "runtime-mock",
		"model":       "mock-1",
	}, http.StatusCreated, &resp)
	return resp["id"].(string)
}

func createProject(t *testing.T, env testEnv, mainAgentID string) string {
	t.Helper()

	var resp map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/projects", map[string]any{
		"name":          "Demo Project",
		"workdir":       "/tmp/demo",
		"main_agent_id": mainAgentID,
	}, http.StatusCreated, &resp)
	return resp["id"].(string)
}

func createChat(t *testing.T, env testEnv, projectID, mainAgentID string) string {
	t.Helper()

	var resp map[string]any
	postJSON(t, env.server, http.MethodPost, "/api/chat/sessions", map[string]any{
		"project_id":    projectID,
		"title":         "Demo Chat",
		"main_agent_id": mainAgentID,
	}, http.StatusCreated, &resp)
	return resp["id"].(string)
}

func waitForChatIdle(t *testing.T, handler http.Handler, chatID string) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var resp map[string]any
		getJSON(t, handler, fmt.Sprintf("/api/chat/sessions/%s", chatID), http.StatusOK, &resp)
		stream, _ := resp["stream"].(map[string]any)
		if stream["status"] == "idle" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("chat %s did not become idle in time", chatID)
}

func postJSON(t *testing.T, handler http.Handler, method, path string, body any, wantStatus int, out any) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		reader = bytes.NewReader(data)
	}

	req := httptest.NewRequest(method, path, reader)
	req = req.WithContext(context.Background())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("%s %s: expected %d, got %d: %s", method, path, wantStatus, rec.Code, rec.Body.String())
	}

	if out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("decode response: %v", err)
		}
	}
}

func getJSON(t *testing.T, handler http.Handler, path string, wantStatus int, out any) {
	t.Helper()
	postJSON(t, handler, http.MethodGet, path, nil, wantStatus, out)
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected file %s to exist: %v", path, err)
	}
}

func readSSELines(body string) []string {
	scanner := bufio.NewScanner(strings.NewReader(body))
	var lines []string
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	return lines
}
