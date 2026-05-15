package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/getcrew44/crew44/daemon/internal/model"
	"github.com/getcrew44/crew44/daemon/internal/rpc"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
)

func TestTransportHealthDoesNotRequireToken(t *testing.T) {
	server := newAuthTransportServer(t, "secret")

	resp, err := http.Get(server.URL + "/health")
	if err != nil {
		t.Fatalf("GET /health: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /health status = %d, want 200", resp.StatusCode)
	}
}

func TestTransportRejectsRPCWithoutToken(t *testing.T) {
	server := newAuthTransportServer(t, "secret")
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/rpc"

	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err == nil {
		t.Fatal("expected websocket dial without token to fail")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %v, want 401", respStatus(resp))
	}
}

func TestTransportAcceptsRPCBearerSubprotocol(t *testing.T) {
	server := newAuthTransportServer(t, "secret")
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/rpc"
	dialer := websocket.Dialer{Subprotocols: []string{rpc.ProtocolV1, "crew44.bearer.secret"}}

	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()
	if conn.Subprotocol() != rpc.ProtocolV1 {
		t.Fatalf("subprotocol = %q, want %q", conn.Subprotocol(), rpc.ProtocolV1)
	}

	if err := conn.WriteJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      "req_1",
		"method":  "system.health",
		"params":  map[string]any{},
	}); err != nil {
		t.Fatalf("write rpc request: %v", err)
	}

	var resp struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      string          `json:"id"`
		Result  json.RawMessage `json:"result"`
		Error   *rpc.Error      `json:"error"`
	}
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("read rpc response: %v", err)
	}
	if resp.JSONRPC != "2.0" || resp.ID != "req_1" || resp.Error != nil {
		t.Fatalf("unexpected rpc response: %#v", resp)
	}
	if !strings.Contains(string(resp.Result), `"status":"ok"`) {
		t.Fatalf("expected health result, got %s", resp.Result)
	}
}

func TestTransportUnknownRPCMethodReturnsJSONRPCError(t *testing.T) {
	server := newAuthTransportServer(t, "")
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/rpc"
	dialer := websocket.Dialer{Subprotocols: []string{rpc.ProtocolV1}}

	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      "req_unknown",
		"method":  "missing.method",
	}); err != nil {
		t.Fatalf("write rpc request: %v", err)
	}

	var resp struct {
		ID    string     `json:"id"`
		Error *rpc.Error `json:"error"`
	}
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("read rpc response: %v", err)
	}
	if resp.ID != "req_unknown" || resp.Error == nil || resp.Error.Code != rpc.CodeMethodNotFound {
		t.Fatalf("unexpected rpc error response: %#v", resp)
	}
}

func TestTransportChatSubscriptionReplaysEventsAndDone(t *testing.T) {
	env := newTransportEnv(t)
	callTransportRPC(t, env.rpcServer, "runtimes.rescan", nil, nil)
	agentID := createTransportAgent(t, env.rpcServer)
	projectID := createTransportProject(t, env.rpcServer, agentID)
	chatID := createTransportChat(t, env.rpcServer, projectID, agentID)
	callTransportRPC(t, env.rpcServer, "chats.messages.post", map[string]any{
		"id":              chatID,
		"content":         "hello",
		"target_agent_id": agentID,
	}, nil)
	waitForTransportChatIdle(t, env.rpcServer, chatID)

	server := httptest.NewServer(env.handler)
	t.Cleanup(server.Close)
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/rpc"
	dialer := websocket.Dialer{Subprotocols: []string{rpc.ProtocolV1}}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial websocket: %v", err)
	}
	defer conn.Close()

	if err := conn.WriteJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      "req_sub",
		"method":  "chats.events.subscribe",
		"params": map[string]any{
			"chat_id": chatID,
			"after":   0,
		},
	}); err != nil {
		t.Fatalf("write subscribe: %v", err)
	}

	sawResponse := false
	sawEvent := false
	sawDone := false
	for i := 0; i < 5 && (!sawResponse || !sawEvent || !sawDone); i++ {
		var message map[string]any
		if err := conn.ReadJSON(&message); err != nil {
			t.Fatalf("read message %d: %v", i, err)
		}
		if message["id"] == "req_sub" {
			sawResponse = true
			continue
		}
		switch message["method"] {
		case "chat.event":
			sawEvent = true
		case "chat.done":
			sawDone = true
		}
	}
	if !sawResponse || !sawEvent || !sawDone {
		t.Fatalf("subscribe saw response=%t event=%t done=%t", sawResponse, sawEvent, sawDone)
	}
}

func newAuthTransportServer(t *testing.T, token string) *httptest.Server {
	t.Helper()
	handler, err := NewServer(ServerConfig{
		StateDir:       t.TempDir(),
		RuntimeScanDir: t.TempDir(),
		Scanner:        &runtime.StaticScanner{},
		Engine:         runtime.MockEngine{},
		AuthToken:      token,
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

type transportEnv struct {
	handler   http.Handler
	rpcServer *rpc.Server
}

func newTransportEnv(t *testing.T) transportEnv {
	t.Helper()
	handler, err := NewServer(ServerConfig{
		StateDir:       t.TempDir(),
		RuntimeScanDir: t.TempDir(),
		Scanner: &runtime.StaticScanner{
			Records: []model.RuntimeRecord{transportMockRuntimeRecord()},
		},
		Engine: runtime.MockEngine{},
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	server, ok := handler.(*Server)
	if !ok {
		t.Fatalf("expected *Server, got %T", handler)
	}
	return transportEnv{handler: handler, rpcServer: server.rpc}
}

func callTransportRPC(t *testing.T, server *rpc.Server, method string, params any, out any) {
	t.Helper()
	rawParams, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal rpc params: %v", err)
	}
	result, err := server.Handle(context.Background(), nil, rpc.Request{
		JSONRPC: rpc.Version,
		Method:  method,
		Params:  rawParams,
	})
	if err != nil {
		t.Fatalf("rpc %s: %v", method, err)
	}
	if out == nil {
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

func createTransportAgent(t *testing.T, server *rpc.Server) string {
	t.Helper()
	var resp map[string]any
	callTransportRPC(t, server, "agents.create", map[string]any{
		"name":        "Aria",
		"instruction": "Be helpful",
		"runtime_id":  "runtime-mock",
		"model":       "mock-1",
	}, &resp)
	return resp["id"].(string)
}

func createTransportProject(t *testing.T, server *rpc.Server, agentID string) string {
	t.Helper()
	var resp map[string]any
	callTransportRPC(t, server, "projects.create", map[string]any{
		"name":          "Demo Project",
		"workdir":       "/tmp/demo",
		"main_agent_id": agentID,
	}, &resp)
	return resp["id"].(string)
}

func createTransportChat(t *testing.T, server *rpc.Server, projectID, agentID string) string {
	t.Helper()
	var resp map[string]any
	callTransportRPC(t, server, "chats.create", map[string]any{
		"project_id":    projectID,
		"title":         "Demo Chat",
		"main_agent_id": agentID,
	}, &resp)
	return resp["id"].(string)
}

func waitForTransportChatIdle(t *testing.T, server *rpc.Server, chatID string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var resp map[string]any
		callTransportRPC(t, server, "chats.get", map[string]any{"id": chatID}, &resp)
		stream, _ := resp["stream"].(map[string]any)
		if stream["status"] == "idle" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("chat %s did not become idle in time", chatID)
}

func transportMockRuntimeRecord() model.RuntimeRecord {
	return model.RuntimeRecord{
		ID:         "runtime-mock",
		Provider:   "mock",
		Name:       "Mock Runtime",
		Status:     model.RuntimeStatusAvailable,
		BinaryPath: "builtin://mock",
		Version:    "test",
	}
}

func respStatus(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}
