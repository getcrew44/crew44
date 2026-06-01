package relay

import (
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestRelayClientWithoutControlGetsDesktopOffline(t *testing.T) {
	wsURL, cleanup := startRelayTestServer(t)
	defer cleanup()

	client := dialRelayRole(t, wsURL, map[string]string{
		"role":      "client",
		"server_id": "server-1",
	})
	defer client.Close()

	if status := readRelayStatus(t, client); status != "desktop_offline" {
		t.Fatalf("status = %q, want desktop_offline", status)
	}
}

func TestRelayClientTimesOutWhenDataDoesNotArrive(t *testing.T) {
	wsURL, cleanup := startRelayTestServer(t)
	defer cleanup()

	restoreTimeout := setRelayPendingDataTimeout(t, 50*time.Millisecond)
	defer restoreTimeout()

	control := dialRelayRole(t, wsURL, map[string]string{
		"role":      "daemon-control",
		"server_id": "server-2",
	})
	defer control.Close()

	client := dialRelayRole(t, wsURL, map[string]string{
		"role":      "client",
		"server_id": "server-2",
	})
	defer client.Close()

	msg := readControlMessage(t, control)
	if msg.Type != "client_connected" || msg.ConnectionID == "" {
		t.Fatalf("control message = %#v, want client_connected with connection id", msg)
	}
	if status := readRelayStatus(t, client); status != "desktop_timeout" {
		t.Fatalf("status = %q, want desktop_timeout", status)
	}
}

func TestRelayClientGetsDesktopOfflineWhenControlDropsWhilePending(t *testing.T) {
	wsURL, cleanup := startRelayTestServer(t)
	defer cleanup()

	restoreTimeout := setRelayPendingDataTimeout(t, time.Second)
	defer restoreTimeout()

	control := dialRelayRole(t, wsURL, map[string]string{
		"role":      "daemon-control",
		"server_id": "server-3",
	})
	client := dialRelayRole(t, wsURL, map[string]string{
		"role":      "client",
		"server_id": "server-3",
	})
	defer client.Close()

	msg := readControlMessage(t, control)
	if msg.Type != "client_connected" || msg.ConnectionID == "" {
		t.Fatalf("control message = %#v, want client_connected with connection id", msg)
	}
	control.Close()

	if status := readRelayStatus(t, client); status != "desktop_offline" {
		t.Fatalf("status = %q, want desktop_offline", status)
	}
}

func TestRelayClientGetsDesktopOnlineAfterDataConnects(t *testing.T) {
	wsURL, cleanup := startRelayTestServer(t)
	defer cleanup()

	restoreTimeout := setRelayPendingDataTimeout(t, time.Second)
	defer restoreTimeout()

	control := dialRelayRole(t, wsURL, map[string]string{
		"role":      "daemon-control",
		"server_id": "server-4",
	})
	defer control.Close()

	client := dialRelayRole(t, wsURL, map[string]string{
		"role":      "client",
		"server_id": "server-4",
	})
	defer client.Close()

	msg := readControlMessage(t, control)
	if msg.Type != "client_connected" || msg.ConnectionID == "" {
		t.Fatalf("control message = %#v, want client_connected with connection id", msg)
	}

	daemon := dialRelayRole(t, wsURL, map[string]string{
		"role":          "daemon-data",
		"server_id":     "server-4",
		"connection_id": msg.ConnectionID,
	})
	defer daemon.Close()

	if status := readRelayStatus(t, client); status != "desktop_online" {
		t.Fatalf("status = %q, want desktop_online", status)
	}

	if err := daemon.WriteMessage(websocket.TextMessage, []byte("hello")); err != nil {
		t.Fatalf("daemon write: %v", err)
	}
	messageType, payload, err := client.ReadMessage()
	if err != nil {
		t.Fatalf("client read bridged payload: %v", err)
	}
	if messageType != websocket.TextMessage || string(payload) != "hello" {
		t.Fatalf("bridged payload = type:%d payload:%q, want text hello", messageType, payload)
	}
}

func TestLateDaemonDataIsRejectedAfterTimeout(t *testing.T) {
	wsURL, cleanup := startRelayTestServer(t)
	defer cleanup()

	restoreTimeout := setRelayPendingDataTimeout(t, 50*time.Millisecond)
	defer restoreTimeout()

	control := dialRelayRole(t, wsURL, map[string]string{
		"role":      "daemon-control",
		"server_id": "server-5",
	})
	defer control.Close()

	client := dialRelayRole(t, wsURL, map[string]string{
		"role":      "client",
		"server_id": "server-5",
	})
	defer client.Close()

	msg := readControlMessage(t, control)
	if msg.Type != "client_connected" || msg.ConnectionID == "" {
		t.Fatalf("control message = %#v, want client_connected with connection id", msg)
	}
	if status := readRelayStatus(t, client); status != "desktop_timeout" {
		t.Fatalf("status = %q, want desktop_timeout", status)
	}

	daemon := dialRelayRole(t, wsURL, map[string]string{
		"role":          "daemon-data",
		"server_id":     "server-5",
		"connection_id": msg.ConnectionID,
	})
	defer daemon.Close()
	_ = daemon.SetReadDeadline(time.Now().Add(500 * time.Millisecond))
	if _, _, err := daemon.ReadMessage(); err == nil {
		t.Fatalf("late daemon-data read = nil error, want closed connection")
	}
}

func startRelayTestServer(t *testing.T) (string, func()) {
	t.Helper()
	server := httptest.NewServer(NewServer())
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/relay", server.Close
}

func dialRelayRole(t *testing.T, wsURL string, params map[string]string) *websocket.Conn {
	t.Helper()
	u, err := url.Parse(wsURL)
	if err != nil {
		t.Fatalf("parse ws url: %v", err)
	}
	query := u.Query()
	for key, value := range params {
		query.Set(key, value)
	}
	u.RawQuery = query.Encode()
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		t.Fatalf("dial relay role %q: %v", params["role"], err)
	}
	return conn
}

func readRelayStatus(t *testing.T, conn *websocket.Conn) string {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	defer conn.SetReadDeadline(time.Time{})
	var msg struct {
		Type string `json:"type"`
	}
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("read relay status: %v", err)
	}
	return msg.Type
}

type controlMessage struct {
	Type         string `json:"type"`
	ConnectionID string `json:"connection_id"`
}

func readControlMessage(t *testing.T, conn *websocket.Conn) controlMessage {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	defer conn.SetReadDeadline(time.Time{})
	var msg controlMessage
	if err := conn.ReadJSON(&msg); err != nil {
		t.Fatalf("read control message: %v", err)
	}
	return msg
}

func setRelayPendingDataTimeout(t *testing.T, timeout time.Duration) func() {
	t.Helper()
	original := relayPendingDataTimeout
	relayPendingDataTimeout = timeout
	return func() {
		relayPendingDataTimeout = original
	}
}
