package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/app"
	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

type testEnv struct {
	server         *Server
	stateDir       string
	runtimeScanDir string
	scanner        *runtime.StaticScanner
}

func newTestEnv(t *testing.T) testEnv {
	return newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{
		Records: []model.RuntimeRecord{mockRuntimeRecord()},
	}, runtime.MockEngine{})
}

func newTestEnvWithEngine(t *testing.T, engine runtime.Engine) testEnv {
	return newTestEnvWithScannerAndEngine(t, &runtime.StaticScanner{
		Records: []model.RuntimeRecord{mockRuntimeRecord()},
	}, engine)
}

func newTestEnvWithScannerAndEngine(t *testing.T, scanner *runtime.StaticScanner, engine runtime.Engine) testEnv {
	t.Helper()

	root := t.TempDir()
	stateDir := filepath.Join(root, ".crew44")
	runtimeScanDir := filepath.Join(root, "runtime-manifests")
	if err := os.MkdirAll(runtimeScanDir, 0o755); err != nil {
		t.Fatalf("mkdir runtime scan dir: %v", err)
	}

	application, err := app.New(app.Config{
		StateDir:       stateDir,
		RuntimeScanDir: runtimeScanDir,
		Scanner:        scanner,
		Engine:         engine,
	})
	if err != nil {
		t.Fatalf("new app: %v", err)
	}
	server := NewServer(Config{App: application})

	return testEnv{
		server:         server,
		stateDir:       stateDir,
		runtimeScanDir: runtimeScanDir,
		scanner:        scanner,
	}
}

type loopingHandoffEngine struct {
	targetID string
}

type multiHandoverEngine struct {
	targets []string
}

type invalidHandoverEngine struct {
	targets []string
}

type markerOnlyHandoverEngine struct {
	target string
}

type noteHandoverEngine struct {
	target string
}

type runtimeErrorEngine struct{}

type emptyAssistantEngine struct{}

type captureRunRequestEngine struct {
	requests chan runtime.RunRequest
}

func (e *captureRunRequestEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	e.requests <- request
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: "captured",
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	return runtime.RunResult{SessionID: "captured-session"}, nil
}

type skillOnlyAnswerEngine struct{}

func (skillOnlyAnswerEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	answer := "missing-skill"
	for _, skill := range request.AgentSkills {
		if strings.Contains(skill.Content, "skill-access-ok") {
			answer = "skill-access-ok"
			break
		}
	}
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: answer,
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	return runtime.RunResult{SessionID: "skill-only-session"}, nil
}

func (e *loopingHandoffEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	sessionID := "loop-guard-" + request.Agent.Name
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeRuntimeSession,
		RuntimeSession: &model.RuntimeSessionPayload{
			RuntimeID: request.Runtime.ID,
			Provider:  request.Runtime.Provider,
			SessionID: sessionID,
			Status:    "running",
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	var content string
	switch request.Agent.Name {
	case "Aria":
		content = "handoff to Bex\n<CREW44_AGENT_HANDOVER agent_id=\"" + e.targetID + "\">Continue the loop guard test.</CREW44_AGENT_HANDOVER>"
	default:
		content = "repeat handoff\n<CREW44_AGENT_HANDOVER agent_id=\"" + request.Agent.ID + "\">Continue the loop guard test.</CREW44_AGENT_HANDOVER>"
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
	return runtime.RunResult{SessionID: sessionID}, nil
}

func (e *multiHandoverEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	content := "received by " + request.Agent.Name
	if request.Agent.Name == "Aria" {
		var lines []string
		lines = append(lines, "handover candidates")
		for _, target := range e.targets {
			lines = append(lines, "<CREW44_AGENT_HANDOVER agent_id=\""+target+"\">Continue with this candidate.</CREW44_AGENT_HANDOVER>")
		}
		content = strings.Join(lines, "\n")
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
	return runtime.RunResult{SessionID: "multi-handover"}, nil
}

func (e *invalidHandoverEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	lines := []string{"invalid handover candidates"}
	for _, target := range e.targets {
		lines = append(lines, "<CREW44_AGENT_HANDOVER agent_id=\""+target+"\">Try this invalid candidate.</CREW44_AGENT_HANDOVER>")
	}
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: strings.Join(lines, "\n"),
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	return runtime.RunResult{SessionID: "invalid-handover"}, nil
}

func (e *markerOnlyHandoverEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	content := "<CREW44_AGENT_HANDOVER agent_id=\"" + e.target + "\">Tell the requested story.</CREW44_AGENT_HANDOVER>"
	if request.Agent.Name != "Aria" {
		content = "target received: " + request.Prompt
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
	return runtime.RunResult{SessionID: "marker-only-handover"}, nil
}

func (e *noteHandoverEngine) Run(_ context.Context, request runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	content := "I will hand this to Bex.\n<CREW44_AGENT_HANDOVER agent_id=\"" + e.target + "\">Write the requested file.</CREW44_AGENT_HANDOVER>"
	if request.Agent.Name != "Aria" {
		content = "target saw original prompt: " + request.Prompt + "\n\ntarget saw system prompt: " + request.Agent.Instruction
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
	return runtime.RunResult{SessionID: "note-handover"}, nil
}

func (runtimeErrorEngine) Run(_ context.Context, _ runtime.RunRequest, _ func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	return runtime.RunResult{}, fmt.Errorf("runtime exploded")
}

func (emptyAssistantEngine) Run(_ context.Context, _ runtime.RunRequest, emit func(runtime.StreamEvent) error) (runtime.RunResult, error) {
	if err := emit(runtime.StreamEvent{
		Type: model.EventTypeMessage,
		Message: &model.MessagePayload{
			Role:    model.MessageRoleAssistant,
			Content: "   ",
		},
	}); err != nil {
		return runtime.RunResult{}, err
	}
	return runtime.RunResult{SessionID: "empty-assistant"}, nil
}

func newServerForState(t *testing.T, stateDir string, scanner runtime.Scanner) *Server {
	t.Helper()

	application, err := app.New(app.Config{
		StateDir:       stateDir,
		RuntimeScanDir: filepath.Join(filepath.Dir(stateDir), "runtime-manifests"),
		Scanner:        scanner,
		Engine:         runtime.MockEngine{},
	})
	if err != nil {
		t.Fatalf("new app for existing state: %v", err)
	}
	server := NewServer(Config{App: application})
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
	callRPCStatus(t, env.server, "agents.create", map[string]any{
		"name":        name,
		"instruction": "Be helpful",
		"runtime_id":  "runtime-mock",
		"model":       "mock-1",
	}, http.StatusCreated, &resp)
	return resp["id"].(string)
}

func defaultAgentID(t *testing.T, env testEnv) string {
	t.Helper()

	var resp map[string]any
	callRPCStatus(t, env.server, "agents.list", nil, http.StatusOK, &resp)
	items, _ := resp["items"].([]any)
	if len(items) == 0 {
		t.Fatal("expected at least one agent")
	}
	agent, _ := items[0].(map[string]any)
	return agent["id"].(string)
}

func createProject(t *testing.T, env testEnv, mainAgentID string) string {
	t.Helper()

	var resp map[string]any
	callRPCStatus(t, env.server, "projects.create", map[string]any{
		"name":          "Demo Project",
		"workdir":       "/tmp/demo",
		"main_agent_id": mainAgentID,
	}, http.StatusCreated, &resp)
	return resp["id"].(string)
}

func createChat(t *testing.T, env testEnv, projectID, mainAgentID string) string {
	t.Helper()

	var resp map[string]any
	callRPCStatus(t, env.server, "chats.create", map[string]any{
		"project_id":    projectID,
		"title":         "Demo Chat",
		"main_agent_id": mainAgentID,
	}, http.StatusCreated, &resp)
	return resp["id"].(string)
}

func waitForChatIdle(t *testing.T, handler *Server, chatID string) {
	t.Helper()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var resp map[string]any
		callRPCStatus(t, handler, "chats.get", rpcParams("id", chatID), http.StatusOK, &resp)
		stream, _ := resp["stream"].(map[string]any)
		if stream["status"] == "idle" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("chat %s did not become idle in time", chatID)
}

func callRPCStatus(t *testing.T, server *Server, method string, params any, wantStatus int, out any) {
	t.Helper()
	result, err := callRPC(t, server, method, params)
	status := rpcHTTPStatus(err)
	if status != wantStatus && !(err == nil && wantStatus >= 200 && wantStatus < 300) {
		t.Fatalf("rpc %s: expected status %d, got %d: %v", method, wantStatus, status, err)
	}
	if err != nil || out == nil {
		return
	}
	data, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal rpc result: %v", err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		t.Fatalf("decode rpc result: %v", err)
	}
}

func callRPC(t *testing.T, server *Server, method string, params any) (any, error) {
	t.Helper()
	rawParams, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal rpc params: %v", err)
	}
	return server.Handle(context.Background(), nil, Request{
		JSONRPC: Version,
		Method:  method,
		Params:  rawParams,
	})
}

func rpcHTTPStatus(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
	case errors.Is(err, app.ErrBadRequest):
		return http.StatusBadRequest
	case errors.Is(err, app.ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, app.ErrConflict):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}

func rpcParams(values ...any) map[string]any {
	params := make(map[string]any, len(values)/2)
	for i := 0; i+1 < len(values); i += 2 {
		key, ok := values[i].(string)
		if !ok {
			panic("rpcParams keys must be strings")
		}
		params[key] = values[i+1]
	}
	return params
}

func withRPCParam(t *testing.T, body any, key string, value any) map[string]any {
	t.Helper()
	params := bodyMap(t, body)
	params[key] = value
	return params
}
func bodyMap(t *testing.T, body any) map[string]any {
	t.Helper()
	if body == nil {
		return map[string]any{}
	}
	data, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("body must be object: %v", err)
	}
	return out
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected file %s to exist: %v", path, err)
	}
}
