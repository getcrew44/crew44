package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
	"github.com/sqtech/crew-ai/crewai-repo/internal/rpc"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
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
	dialer := websocket.Dialer{Subprotocols: []string{rpc.ProtocolV1, "crewai.bearer.secret"}}

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
	env := newTestEnv(t)
	postJSON(t, env.server, http.MethodPost, "/api/runtimes/rescan", nil, http.StatusOK, nil)
	agentID := createAgent(t, env, "Aria")
	projectID := createProject(t, env, agentID)
	chatID := createChat(t, env, projectID, agentID)
	postJSON(t, env.server, http.MethodPost, fmt.Sprintf("/api/chat/sessions/%s/messages", chatID), map[string]any{
		"content":         "hello",
		"target_agent_id": agentID,
	}, http.StatusAccepted, nil)
	waitForChatIdle(t, env.server, chatID)

	server := httptest.NewServer(env.server)
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

func respStatus(resp *http.Response) int {
	if resp == nil {
		return 0
	}
	return resp.StatusCode
}
