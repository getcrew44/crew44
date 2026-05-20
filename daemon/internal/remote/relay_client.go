package remote

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type RelayClient struct {
	manager *Manager

	mu      sync.Mutex
	running map[string]context.CancelFunc
	ctx     context.Context
}

type relayControlMessage struct {
	Type         string `json:"type"`
	ConnectionID string `json:"connection_id"`
}

const (
	relayControlWriteWait  = 10 * time.Second
	relayControlPingPeriod = 10 * time.Second
)

func NewRelayClient(manager *Manager) *RelayClient {
	return &RelayClient{
		manager: manager,
		running: make(map[string]context.CancelFunc),
	}
}

func (c *RelayClient) Start(ctx context.Context) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ctx = ctx
}

func (c *RelayClient) Ensure(relayURL string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ctx == nil {
		return
	}
	if _, ok := c.running[relayURL]; ok {
		return
	}
	ctx, cancel := context.WithCancel(c.ctx)
	c.running[relayURL] = cancel
	go c.controlLoop(ctx, relayURL)
}

func (c *RelayClient) controlLoop(ctx context.Context, relayURL string) {
	backoff := 250 * time.Millisecond
	for {
		if ctx.Err() != nil {
			return
		}
		if err := c.runControl(ctx, relayURL); err != nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
				if backoff < 5*time.Second {
					backoff *= 2
				}
			}
			continue
		}
		backoff = 250 * time.Millisecond
	}
}

func (c *RelayClient) runControl(ctx context.Context, relayURL string) error {
	wsURL, err := relayEndpoint(relayURL, map[string]string{
		"role":      "daemon-control",
		"server_id": c.manager.identity.ServerID,
	})
	if err != nil {
		return err
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, http.Header{})
	if err != nil {
		return err
	}
	defer conn.Close()
	heartbeatDone := make(chan struct{})
	go keepRelayControlAlive(ctx, conn, heartbeatDone, relayURL)
	defer close(heartbeatDone)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		var msg relayControlMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == "client_connected" && msg.ConnectionID != "" {
			go c.openData(ctx, relayURL, msg.ConnectionID)
		}
	}
}

func keepRelayControlAlive(ctx context.Context, conn *websocket.Conn, done <-chan struct{}, relayURL string) {
	ticker := time.NewTicker(relayControlPingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(relayControlWriteWait)); err != nil {
				log.Printf("remote relay control heartbeat failed relay_url=%s err=%v", relayURL, err)
				_ = conn.Close()
				return
			}
		case <-done:
			return
		case <-ctx.Done():
			return
		}
	}
}

func (c *RelayClient) openData(ctx context.Context, relayURL, connectionID string) {
	wsURL, err := relayEndpoint(relayURL, map[string]string{
		"role":          "daemon-data",
		"server_id":     c.manager.identity.ServerID,
		"connection_id": connectionID,
	})
	if err != nil {
		return
	}
	conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, http.Header{})
	if err != nil {
		return
	}
	c.manager.ServeRemoteWebSocket(ctx, conn)
}

func relayEndpoint(base string, query map[string]string) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	values := u.Query()
	for key, value := range query {
		values.Set(key, value)
	}
	u.RawQuery = values.Encode()
	if u.Path == "" || u.Path == "/" {
		u.Path = "/relay"
	}
	return u.String(), nil
}
