package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/flynn/noise"
	"github.com/gorilla/websocket"
	"github.com/getcrew44/crew44/daemon/internal/app"
	"github.com/getcrew44/crew44/daemon/internal/rpc"
)

type sessionHello struct {
	Type string `json:"type"`
	Mode string `json:"mode"`
}

type pairRegisterParams struct {
	PairingID     string `json:"pairing_id"`
	PairingSecret string `json:"pairing_secret"`
	DeviceName    string `json:"device_name"`
	DevicePubKey  string `json:"device_pubkey"`
}

func (m *Manager) ServeRemoteWebSocket(ctx context.Context, ws *websocket.Conn) {
	defer ws.Close()

	hello, err := readSessionHello(ws)
	if err != nil {
		return
	}
	switch hello.Mode {
	case PairingMode:
		m.servePairingSession(ws)
	case DeviceMode:
		m.serveDeviceSession(ctx, ws)
	}
}

func readSessionHello(ws *websocket.Conn) (sessionHello, error) {
	_, data, err := ws.ReadMessage()
	if err != nil {
		return sessionHello{}, err
	}
	var hello sessionHello
	if err := json.Unmarshal(data, &hello); err != nil {
		return sessionHello{}, err
	}
	if hello.Type != "noise_init" || (hello.Mode != PairingMode && hello.Mode != DeviceMode) {
		return sessionHello{}, fmt.Errorf("invalid remote hello")
	}
	return hello, nil
}

func (m *Manager) servePairingSession(ws *websocket.Conn) {
	transport, err := m.handshakePairing(ws)
	if err != nil {
		return
	}
	req, err := readRPCRequest(transport)
	if err != nil {
		return
	}
	if req.Method != "remote.pair.register" {
		_ = writeRPCError(transport, req.ID, rpc.CodeMethodNotFound, "method not found")
		return
	}
	var params pairRegisterParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		_ = writeRPCError(transport, req.ID, rpc.CodeInvalidParams, err.Error())
		return
	}
	device, err := m.RegisterPairing(params.PairingID, params.PairingSecret, params.DeviceName, params.DevicePubKey)
	if err != nil {
		_ = writeRPCError(transport, req.ID, mapRemoteErrorCode(err), err.Error())
		return
	}
	_ = writeRPCResult(transport, req.ID, map[string]any{"device": device})
}

func (m *Manager) serveDeviceSession(ctx context.Context, ws *websocket.Conn) {
	transport, peerStatic, err := m.handshakeDevice(ws)
	if err != nil {
		return
	}
	device, err := m.AuthorizeDevice(encodeKey(peerStatic))
	if err != nil {
		return
	}
	server := m.server()
	if server == nil {
		return
	}
	sessionCtx, cancel := context.WithCancel(ctx)
	m.trackDeviceSession(device.ID, cancel)
	defer func() {
		cancel()
		m.forgetDeviceSession(device.ID)
	}()
	rpc.NewConn(transport).Run(sessionCtx, server)
}

func (m *Manager) handshakePairing(ws *websocket.Conn) (*NoiseTransport, error) {
	key, err := identityKey(m.identity)
	if err != nil {
		return nil, err
	}
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   noiseCipherSuite,
		Pattern:       noise.HandshakeNK,
		Initiator:     false,
		StaticKeypair: key,
	})
	if err != nil {
		return nil, err
	}
	return finishResponderHandshake(ws, hs)
}

func (m *Manager) handshakeDevice(ws *websocket.Conn) (*NoiseTransport, []byte, error) {
	key, err := identityKey(m.identity)
	if err != nil {
		return nil, nil, err
	}
	hs, err := noise.NewHandshakeState(noise.Config{
		CipherSuite:   noiseCipherSuite,
		Pattern:       noise.HandshakeXK,
		Initiator:     false,
		StaticKeypair: key,
	})
	if err != nil {
		return nil, nil, err
	}
	transport, err := finishResponderHandshake(ws, hs)
	if err != nil {
		return nil, nil, err
	}
	return transport, hs.PeerStatic(), nil
}

func finishResponderHandshake(ws *websocket.Conn, hs *noise.HandshakeState) (*NoiseTransport, error) {
	var c1, c2 *noise.CipherState
	for c1 == nil || c2 == nil {
		_, message, err := ws.ReadMessage()
		if err != nil {
			return nil, err
		}
		if _, c1, c2, err = hs.ReadMessage(nil, message); err != nil {
			return nil, err
		}
		if c1 != nil && c2 != nil {
			break
		}
		reply, nextC1, nextC2, err := hs.WriteMessage(nil, nil)
		if err != nil {
			return nil, err
		}
		if err := ws.WriteMessage(websocket.BinaryMessage, reply); err != nil {
			return nil, err
		}
		c1, c2 = nextC1, nextC2
	}
	return NewNoiseTransport(ws, c2, c1), nil
}

type NoiseTransport struct {
	ws         *websocket.Conn
	sendCipher *noise.CipherState
	recvCipher *noise.CipherState
	writeMu    sync.Mutex
}

func NewNoiseTransport(ws *websocket.Conn, sendCipher, recvCipher *noise.CipherState) *NoiseTransport {
	return &NoiseTransport{ws: ws, sendCipher: sendCipher, recvCipher: recvCipher}
}

func (t *NoiseTransport) ReadFrame() ([]byte, error) {
	_, ciphertext, err := t.ws.ReadMessage()
	if err != nil {
		return nil, err
	}
	return t.recvCipher.Decrypt(nil, nil, ciphertext)
}

func (t *NoiseTransport) WriteFrame(data []byte) error {
	ciphertext, err := t.sendCipher.Encrypt(nil, nil, data)
	if err != nil {
		return err
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	return t.ws.WriteMessage(websocket.BinaryMessage, ciphertext)
}

func (t *NoiseTransport) Close() error {
	return t.ws.Close()
}

func readRPCRequest(transport rpc.FrameTransport) (rpc.Request, error) {
	data, err := transport.ReadFrame()
	if err != nil {
		return rpc.Request{}, err
	}
	var req rpc.Request
	if err := json.Unmarshal(data, &req); err != nil {
		return rpc.Request{}, err
	}
	return req, nil
}

func writeRPCResult(transport rpc.FrameTransport, id json.RawMessage, result any) error {
	return writeRPCMessage(transport, rpc.Response{JSONRPC: rpc.Version, ID: normalizeRPCID(id), Result: result})
}

func writeRPCError(transport rpc.FrameTransport, id json.RawMessage, code int, message string) error {
	return writeRPCMessage(transport, rpc.Response{
		JSONRPC: rpc.Version,
		ID:      normalizeRPCID(id),
		Error:   &rpc.Error{Code: code, Message: message},
	})
}

func writeRPCMessage(transport rpc.FrameTransport, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return transport.WriteFrame(data)
}

func normalizeRPCID(id json.RawMessage) json.RawMessage {
	if len(id) == 0 {
		return json.RawMessage("null")
	}
	return id
}

func mapRemoteErrorCode(err error) int {
	switch {
	case errors.Is(err, app.ErrBadRequest):
		return rpc.CodeBadRequest
	case errors.Is(err, app.ErrNotFound):
		return rpc.CodeNotFound
	case errors.Is(err, app.ErrUnauthorized):
		return rpc.CodeUnauthorized
	default:
		return rpc.CodeInternalError
	}
}
