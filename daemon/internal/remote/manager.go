package remote

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/app"
	"github.com/getcrew44/crew44/daemon/internal/rpc"
)

const (
	pairingTTL  = 5 * time.Minute
	pairingType = "crew44-remote-pairing"
)

type Manager struct {
	store    *Store
	identity Identity

	mu       sync.Mutex
	pairings map[string]PairingSession
	sessions map[string]context.CancelFunc

	rpcServer *rpc.Server
	relay     *RelayClient
}

func NewManager(stateDir string) (*Manager, error) {
	store := NewStore(stateDir)
	identity, err := store.EnsureIdentity()
	if err != nil {
		return nil, err
	}
	manager := &Manager{
		store:    store,
		identity: identity,
		pairings: make(map[string]PairingSession),
		sessions: make(map[string]context.CancelFunc),
	}
	manager.relay = NewRelayClient(manager)
	return manager, nil
}

func (m *Manager) SetRPCServer(server *rpc.Server) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rpcServer = server
}

func (m *Manager) Start(ctx context.Context) error {
	m.relay.Start(ctx)
	devices, err := m.store.ListDevices()
	if err != nil {
		return err
	}
	for _, device := range devices {
		if device.RelayURL != "" {
			m.relay.Ensure(device.RelayURL)
		}
	}
	return nil
}

func (m *Manager) Status(context.Context) (any, error) {
	devices, err := m.store.ListDevices()
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"server_id":     m.identity.ServerID,
		"daemon_pubkey": m.identity.PublicKey,
		"device_count":  len(devices),
	}, nil
}

func (m *Manager) CreatePairing(_ context.Context, relayURL string) (any, error) {
	relayURL = normalizeRelayURL(relayURL)
	if relayURL == "" {
		return nil, fmt.Errorf("%w: relay_url is required", app.ErrBadRequest)
	}
	parsedRelayURL, err := url.ParseRequestURI(relayURL)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid relay_url", app.ErrBadRequest)
	}
	if parsedRelayURL.Scheme != "ws" && parsedRelayURL.Scheme != "wss" {
		return nil, fmt.Errorf("%w: relay_url must use ws or wss", app.ErrBadRequest)
	}

	now := time.Now().UTC()
	desktopName, _ := os.Hostname()
	offer := PairingOffer{
		Version:       1,
		Type:          pairingType,
		RelayURL:      relayURL,
		ServerID:      m.identity.ServerID,
		DesktopName:   desktopName,
		DaemonPubKey:  m.identity.PublicKey,
		PairingID:     newPairingID(),
		PairingSecret: newSecret(),
		ExpiresAt:     now.Add(pairingTTL),
	}
	qr, err := json.Marshal(offer)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	m.pruneExpiredPairingsLocked(now)
	m.pairings[offer.PairingID] = PairingSession{Offer: offer, CreatedAt: now}
	m.mu.Unlock()

	m.relay.Ensure(relayURL)
	return map[string]any{
		"offer":   offer,
		"qr_text": string(qr),
	}, nil
}

func (m *Manager) ListDevices(context.Context) (any, error) {
	devices, err := m.store.ListDevices()
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": devices}, nil
}

func (m *Manager) DeleteDevice(_ context.Context, id string) (any, error) {
	if id == "" {
		return nil, fmt.Errorf("%w: device_id is required", app.ErrBadRequest)
	}
	if err := m.store.DeleteDevice(id); err != nil {
		if errors.Is(err, os.ErrInvalid) {
			return nil, fmt.Errorf("%w: invalid device_id", app.ErrBadRequest)
		}
		return nil, err
	}
	m.closeDeviceSession(id)
	return map[string]any{"ok": true}, nil
}

func (m *Manager) RegisterPairing(pairingID, pairingSecret, deviceName, devicePubKey string) (Device, error) {
	if pairingID == "" || pairingSecret == "" || devicePubKey == "" {
		return Device{}, fmt.Errorf("%w: pairing_id, pairing_secret, and device_pubkey are required", app.ErrBadRequest)
	}
	if _, err := decodeKey(devicePubKey); err != nil {
		return Device{}, fmt.Errorf("%w: invalid device_pubkey", app.ErrBadRequest)
	}

	now := time.Now().UTC()
	m.mu.Lock()
	m.pruneExpiredPairingsLocked(now)
	session, ok := m.pairings[pairingID]
	if ok {
		delete(m.pairings, pairingID)
	}
	m.mu.Unlock()
	if !ok {
		return Device{}, fmt.Errorf("%w: pairing not found", app.ErrNotFound)
	}
	if subtle.ConstantTimeCompare([]byte(pairingSecret), []byte(session.Offer.PairingSecret)) != 1 {
		return Device{}, fmt.Errorf("%w: invalid pairing_secret", app.ErrBadRequest)
	}

	device := Device{
		ID:        deviceID(devicePubKey),
		Name:      firstNonEmpty(deviceName, "Phone"),
		PublicKey: devicePubKey,
		RelayURL:  session.Offer.RelayURL,
		CreatedAt: now,
	}
	if err := m.store.SaveDevice(device); err != nil {
		return Device{}, err
	}
	m.relay.Ensure(device.RelayURL)
	return device, nil
}

func (m *Manager) AuthorizeDevice(publicKey string) (Device, error) {
	device, err := m.store.FindDeviceByPublicKey(publicKey)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Device{}, app.ErrUnauthorized
		}
		return Device{}, err
	}
	if err := m.store.TouchDevice(device.ID, time.Now().UTC()); err != nil {
		return Device{}, err
	}
	return device, nil
}

func (m *Manager) server() *rpc.Server {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.rpcServer
}

func (m *Manager) trackDeviceSession(deviceID string, cancel context.CancelFunc) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[deviceID] = cancel
}

func (m *Manager) forgetDeviceSession(deviceID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, deviceID)
}

func (m *Manager) closeDeviceSession(deviceID string) {
	m.mu.Lock()
	cancel := m.sessions[deviceID]
	delete(m.sessions, deviceID)
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (m *Manager) pruneExpiredPairingsLocked(now time.Time) {
	for id, session := range m.pairings {
		if !session.Offer.ExpiresAt.After(now) {
			delete(m.pairings, id)
		}
	}
}

func normalizeRelayURL(value string) string {
	return strings.TrimSpace(value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
