package remote_test

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/flynn/noise"
	"github.com/getcrew44/crew44/daemon/internal/httpapi"
	"github.com/getcrew44/crew44/daemon/internal/relay"
	"github.com/getcrew44/crew44/daemon/internal/remote"
	"github.com/getcrew44/crew44/daemon/internal/rpc"
	"github.com/getcrew44/crew44/daemon/internal/runtime"
	"github.com/gorilla/websocket"
)

func TestRemotePairingAndDeviceRPCOverRelay(t *testing.T) {
	relayServer := httptest.NewServer(relay.NewServer())
	t.Cleanup(relayServer.Close)
	relayURL := "ws" + strings.TrimPrefix(relayServer.URL, "http") + "/relay"

	handler, err := httpapi.NewServer(httpapi.ServerConfig{
		StateDir:       t.TempDir(),
		RuntimeScanDir: t.TempDir(),
		Scanner:        &runtime.StaticScanner{},
		Engine:         runtime.MockEngine{},
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	daemonServer := httptest.NewServer(handler)
	t.Cleanup(daemonServer.Close)

	localRPC := dialLocalRPC(t, daemonServer.URL)
	defer localRPC.Close()
	offer := createRemotePairing(t, localRPC, relayURL)

	deviceKey, err := noise.DH25519.GenerateKeypair(nil)
	if err != nil {
		t.Fatalf("generate device key: %v", err)
	}
	device := registerPairingOverRelay(t, relayURL, offer, deviceKey)
	if device.ID == "" {
		t.Fatalf("registered device missing id: %#v", device)
	}

	devices := listRemoteDevices(t, localRPC)
	if len(devices) != 1 || devices[0].ID != device.ID {
		t.Fatalf("devices = %#v, want registered device %s", devices, device.ID)
	}

	remoteRPC := dialDeviceOverRelay(t, relayURL, offer, deviceKey)
	defer remoteRPC.Close()
	result := encryptedRPCCall(t, remoteRPC, "system.health", nil)
	if !strings.Contains(string(result), `"status":"ok"`) {
		t.Fatalf("remote system.health result = %s", result)
	}
}

func TestRemoteDeletedDeviceCannotReconnect(t *testing.T) {
	relayServer := httptest.NewServer(relay.NewServer())
	t.Cleanup(relayServer.Close)
	relayURL := "ws" + strings.TrimPrefix(relayServer.URL, "http") + "/relay"

	handler, err := httpapi.NewServer(httpapi.ServerConfig{
		StateDir:       t.TempDir(),
		RuntimeScanDir: t.TempDir(),
		Scanner:        &runtime.StaticScanner{},
		Engine:         runtime.MockEngine{},
	})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	daemonServer := httptest.NewServer(handler)
	t.Cleanup(daemonServer.Close)

	localRPC := dialLocalRPC(t, daemonServer.URL)
	defer localRPC.Close()
	offer := createRemotePairing(t, localRPC, relayURL)

	deviceKey, err := noise.DH25519.GenerateKeypair(nil)
	if err != nil {
		t.Fatalf("generate device key: %v", err)
	}
	device := registerPairingOverRelay(t, relayURL, offer, deviceKey)

	activeConn := dialDeviceOverRelay(t, relayURL, offer, deviceKey)
	rpcCall(t, localRPC, "remote.devices.delete", map[string]any{"device_id": device.ID})
	assertRevokedNotification(t, activeConn)

	conn := dialDeviceOverRelay(t, relayURL, offer, deviceKey)
	defer conn.Close()
	assertRevokedNotification(t, conn)
}

func dialLocalRPC(t *testing.T, serverURL string) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(serverURL, "http") + "/rpc"
	dialer := websocket.Dialer{Subprotocols: []string{rpc.ProtocolV1}}
	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial local rpc: %v", err)
	}
	return conn
}

func createRemotePairing(t *testing.T, conn *websocket.Conn, relayURL string) remote.PairingOffer {
	t.Helper()
	result := rpcCall(t, conn, "remote.pairing.create", map[string]any{"relay_url": relayURL})
	var body struct {
		Offer remote.PairingOffer `json:"offer"`
	}
	if err := json.Unmarshal(result, &body); err != nil {
		t.Fatalf("decode pairing result: %v", err)
	}
	if body.Offer.PairingID == "" || body.Offer.PairingSecret == "" {
		t.Fatalf("invalid offer: %#v", body.Offer)
	}
	return body.Offer
}

func listRemoteDevices(t *testing.T, conn *websocket.Conn) []remote.Device {
	t.Helper()
	result := rpcCall(t, conn, "remote.devices.list", nil)
	var body struct {
		Items []remote.Device `json:"items"`
	}
	if err := json.Unmarshal(result, &body); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	return body.Items
}

func registerPairingOverRelay(t *testing.T, relayURL string, offer remote.PairingOffer, deviceKey noise.DHKey) remote.Device {
	t.Helper()
	conn := eventuallyDialRelayClient(t, relayURL, offer.ServerID)
	defer conn.Close()
	transport := handshakePairingClient(t, conn, offer)
	if err := transport.WriteFrame(mustJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      "pair_register",
		"method":  "remote.pair.register",
		"params": map[string]any{
			"pairing_id":     offer.PairingID,
			"pairing_secret": offer.PairingSecret,
			"device_name":    "Test Phone",
			"device_pubkey":  base64Key(deviceKey.Public),
		},
	})); err != nil {
		t.Fatalf("write pair.register: %v", err)
	}
	var resp struct {
		Result struct {
			Device remote.Device `json:"device"`
		} `json:"result"`
		Error *rpc.Error `json:"error"`
	}
	readEncryptedJSON(t, transport, &resp)
	if resp.Error != nil {
		t.Fatalf("pair.register error: %#v", resp.Error)
	}
	return resp.Result.Device
}

func dialDeviceOverRelay(t *testing.T, relayURL string, offer remote.PairingOffer, deviceKey noise.DHKey) *remote.NoiseTransport {
	t.Helper()
	conn := eventuallyDialRelayClient(t, relayURL, offer.ServerID)
	transport := handshakeDeviceClient(t, conn, offer, deviceKey)
	t.Cleanup(func() { _ = transport.Close() })
	return transport
}

// eventuallyDialRelayClient dials the relay's client role and waits until
// the daemon is fully ready for the session, which the relay now signals
// by greeting the client with "desktop_online". Before control is connected
// (or before daemon-data is ready), the relay responds with a non-online
// status and closes the connection, so polling the first frame avoids
// racing the daemon's relay-client goroutine in CI.
//
// On success the desktop_online greeting has been consumed, so callers
// proceed directly to the noise handshake. The deadline is generous
// (5s) so a slow CI machine doesn't flake on startup contention.
func eventuallyDialRelayClient(t *testing.T, relayURL, serverID string) *websocket.Conn {
	t.Helper()
	wsURL := relayURL + "?role=client&server_id=" + serverID
	var lastErr error
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
		if err != nil {
			lastErr = err
			time.Sleep(25 * time.Millisecond)
			continue
		}
		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var greeting struct {
			Type string `json:"type"`
		}
		if err := conn.ReadJSON(&greeting); err != nil {
			lastErr = err
			conn.Close()
			time.Sleep(25 * time.Millisecond)
			continue
		}
		_ = conn.SetReadDeadline(time.Time{})
		if greeting.Type == "desktop_online" {
			return conn
		}
		// desktop_offline (or anything else) — relay has already closed
		// the connection, so retry the dial after a small backoff.
		conn.Close()
		lastErr = fmt.Errorf("relay greeted with %q", greeting.Type)
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("dial relay client: %v", lastErr)
	return nil
}

func handshakePairingClient(t *testing.T, conn *websocket.Conn, offer remote.PairingOffer) *remote.NoiseTransport {
	t.Helper()
	// desktop_online greeting is already consumed by eventuallyDialRelayClient.
	if err := conn.WriteJSON(map[string]string{"type": "noise_init", "mode": remote.PairingMode}); err != nil {
		t.Fatalf("write pairing hello: %v", err)
	}
	daemonPubKey := decodeBase64Key(t, offer.DaemonPubKey)
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite: remoteTestCipherSuite(),
		Pattern:     noise.HandshakeNK,
		Initiator:   true,
		PeerStatic:  daemonPubKey,
	})
	if err != nil {
		t.Fatalf("new pairing handshake: %v", err)
	}
	msg, _, _, err := hs.WriteMessage(nil, nil)
	if err != nil {
		t.Fatalf("write pairing handshake: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
		t.Fatalf("send pairing handshake: %v", err)
	}
	_, reply, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read pairing handshake: %v", err)
	}
	_, send, recv, err := hs.ReadMessage(nil, reply)
	if err != nil {
		t.Fatalf("finish pairing handshake: %v", err)
	}
	return remote.NewNoiseTransport(conn, send, recv)
}

func handshakeDeviceClient(t *testing.T, conn *websocket.Conn, offer remote.PairingOffer, deviceKey noise.DHKey) *remote.NoiseTransport {
	t.Helper()
	// desktop_online greeting is already consumed by eventuallyDialRelayClient.
	if err := conn.WriteJSON(map[string]string{"type": "noise_init", "mode": remote.DeviceMode}); err != nil {
		t.Fatalf("write device hello: %v", err)
	}
	daemonPubKey := decodeBase64Key(t, offer.DaemonPubKey)
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   remoteTestCipherSuite(),
		Pattern:       noise.HandshakeXK,
		Initiator:     true,
		StaticKeypair: deviceKey,
		PeerStatic:    daemonPubKey,
	})
	if err != nil {
		t.Fatalf("new device handshake: %v", err)
	}
	msg, _, _, err := hs.WriteMessage(nil, nil)
	if err != nil {
		t.Fatalf("write device handshake 1: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
		t.Fatalf("send device handshake 1: %v", err)
	}
	_, reply, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read device handshake 2: %v", err)
	}
	if _, _, _, err := hs.ReadMessage(nil, reply); err != nil {
		t.Fatalf("read device handshake 2: %v", err)
	}
	msg, send, recv, err := hs.WriteMessage(nil, nil)
	if err != nil {
		t.Fatalf("write device handshake 3: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
		t.Fatalf("send device handshake 3: %v", err)
	}
	return remote.NewNoiseTransport(conn, send, recv)
}

func rpcCall(t *testing.T, conn *websocket.Conn, method string, params any) json.RawMessage {
	t.Helper()
	if err := conn.WriteJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      method,
		"method":  method,
		"params":  params,
	}); err != nil {
		t.Fatalf("write rpc %s: %v", method, err)
	}
	var resp struct {
		Result json.RawMessage `json:"result"`
		Error  *rpc.Error      `json:"error"`
	}
	if err := conn.ReadJSON(&resp); err != nil {
		t.Fatalf("read rpc %s: %v", method, err)
	}
	if resp.Error != nil {
		t.Fatalf("rpc %s error: %#v", method, resp.Error)
	}
	return resp.Result
}

func readEncryptedJSON(t *testing.T, transport *remote.NoiseTransport, out any) {
	t.Helper()
	data, err := transport.ReadFrame()
	if err != nil {
		t.Fatalf("read encrypted frame: %v", err)
	}
	if err := json.Unmarshal(data, out); err != nil {
		t.Fatalf("decode encrypted json: %v", err)
	}
}

func encryptedRPCCall(t *testing.T, transport *remote.NoiseTransport, method string, params any) json.RawMessage {
	t.Helper()
	if err := transport.WriteFrame(mustJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      method,
		"method":  method,
		"params":  params,
	})); err != nil {
		t.Fatalf("write encrypted rpc %s: %v", method, err)
	}
	var resp struct {
		Result json.RawMessage `json:"result"`
		Error  *rpc.Error      `json:"error"`
	}
	readEncryptedJSON(t, transport, &resp)
	if resp.Error != nil {
		t.Fatalf("encrypted rpc %s error: %#v", method, resp.Error)
	}
	return resp.Result
}

func assertRevokedNotification(t *testing.T, transport *remote.NoiseTransport) {
	t.Helper()
	var notification struct {
		Method string `json:"method"`
		Params struct {
			DeviceID string `json:"device_id"`
			Reason   string `json:"reason"`
		} `json:"params"`
	}
	readEncryptedJSON(t, transport, &notification)
	if notification.Method != "remote.device.revoked" {
		t.Fatalf("expected remote.device.revoked notification, got %#v", notification)
	}
}

func mustJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}

func remoteTestCipherSuite() noise.CipherSuite {
	return noise.NewCipherSuite(noise.DH25519, noise.CipherChaChaPoly, noise.HashBLAKE2s)
}

func base64Key(raw []byte) string {
	return base64.RawStdEncoding.EncodeToString(raw)
}

func decodeBase64Key(t *testing.T, value string) []byte {
	t.Helper()
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil {
		t.Fatalf("decode key: %v", err)
	}
	return raw
}
