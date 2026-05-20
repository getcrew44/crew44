package relay

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/getcrew44/crew44/daemon/internal/id"
	"github.com/gorilla/websocket"
)

const (
	relayWriteWait  = 10 * time.Second
	relayPingPeriod = 10 * time.Second
)

type Server struct {
	mu       sync.Mutex
	servers  map[string]*serverHub
	upgrader websocket.Upgrader
}

type serverHub struct {
	control   *relayConn
	controlMu sync.Mutex
	pending   map[string]*pendingConn
}

type pendingConn struct {
	client *relayConn
	daemon *relayConn
}

type relayConn struct {
	ws            *websocket.Conn
	role          string
	serverID      string
	connectionID  string
	remoteAddr    string
	writeMu       sync.Mutex
	closeOnce     sync.Once
	heartbeatDone chan struct{}
}

func NewServer() *Server {
	return &Server{
		servers: make(map[string]*serverHub),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/health":
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	case "/relay":
		s.serveRelay(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) serveRelay(w http.ResponseWriter, r *http.Request) {
	role := r.URL.Query().Get("role")
	serverID := r.URL.Query().Get("server_id")
	remoteAddr := requestRemoteAddr(r)
	if serverID == "" {
		http.Error(w, "server_id is required", http.StatusBadRequest)
		return
	}
	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("relay upgrade failed role=%s server_id=%s remote=%s err=%v", role, serverID, remoteAddr, err)
		return
	}
	switch role {
	case "daemon-control":
		s.serveControl(serverID, newRelayConn(ws, role, serverID, "", remoteAddr))
	case "status":
		s.serveStatus(serverID, newRelayConn(ws, role, serverID, "", remoteAddr))
	case "client":
		s.serveClient(serverID, newRelayConn(ws, role, serverID, "", remoteAddr))
	case "daemon-data":
		connectionID := r.URL.Query().Get("connection_id")
		s.serveDaemonData(serverID, connectionID, newRelayConn(ws, role, serverID, connectionID, remoteAddr))
	default:
		log.Printf("relay closing unknown role=%s server_id=%s remote=%s", role, serverID, remoteAddr)
		_ = ws.Close()
	}
}

func (s *Server) serveStatus(serverID string, conn *relayConn) {
	defer conn.close()
	status := "desktop_offline"
	s.mu.Lock()
	hub := s.hubLocked(serverID)
	if hub.control != nil {
		status = "desktop_online"
	}
	s.mu.Unlock()
	if err := conn.writeJSON(map[string]any{"type": status}); err != nil {
		log.Printf("relay status write failed server_id=%s remote=%s err=%v", serverID, conn.remoteAddr, err)
		return
	}
	log.Printf("relay status served server_id=%s remote=%s status=%s", serverID, conn.remoteAddr, status)
}

func (s *Server) serveControl(serverID string, conn *relayConn) {
	conn.startHeartbeat()
	defer conn.close()

	s.mu.Lock()
	hub := s.hubLocked(serverID)
	if hub.control != nil {
		log.Printf("relay replacing control server_id=%s old_remote=%s new_remote=%s", serverID, hub.control.remoteAddr, conn.remoteAddr)
		hub.control.close()
	}
	hub.control = conn
	s.mu.Unlock()
	log.Printf("relay control connected server_id=%s remote=%s", serverID, conn.remoteAddr)

	for {
		if _, _, err := conn.ws.ReadMessage(); err != nil {
			s.mu.Lock()
			if s.servers[serverID] == hub && hub.control == conn {
				hub.control = nil
			}
			s.mu.Unlock()
			log.Printf("relay control closed server_id=%s remote=%s err=%v", serverID, conn.remoteAddr, err)
			return
		}
	}
}

func (s *Server) serveClient(serverID string, conn *relayConn) {
	connectionID := "conn_" + id.New()
	conn.connectionID = connectionID
	conn.startHeartbeat()
	pending := &pendingConn{client: conn}

	s.mu.Lock()
	hub := s.hubLocked(serverID)
	if hub.control == nil {
		s.mu.Unlock()
		log.Printf("relay client rejected desktop_offline server_id=%s connection_id=%s remote=%s", serverID, connectionID, conn.remoteAddr)
		_ = conn.writeJSON(map[string]any{"type": "desktop_offline"})
		conn.close()
		return
	}
	hub.pending[connectionID] = pending
	s.mu.Unlock()
	log.Printf("relay client queued server_id=%s connection_id=%s remote=%s", serverID, connectionID, conn.remoteAddr)

	if hub.writeControl(map[string]any{"type": "client_connected", "connection_id": connectionID}) != nil {
		s.removePending(serverID, connectionID)
		log.Printf("relay client notify failed server_id=%s connection_id=%s remote=%s", serverID, connectionID, conn.remoteAddr)
		_ = conn.writeJSON(map[string]any{"type": "desktop_offline"})
		conn.close()
		return
	}
	if err := conn.writeJSON(map[string]any{"type": "desktop_online"}); err != nil {
		s.removePending(serverID, connectionID)
		log.Printf("relay client status write failed server_id=%s connection_id=%s remote=%s err=%v", serverID, connectionID, conn.remoteAddr, err)
		conn.close()
		return
	}
}

func (s *Server) serveDaemonData(serverID, connectionID string, conn *relayConn) {
	if connectionID == "" {
		log.Printf("relay daemon-data missing connection_id server_id=%s remote=%s", serverID, conn.remoteAddr)
		conn.close()
		return
	}
	conn.startHeartbeat()
	s.mu.Lock()
	hub := s.hubLocked(serverID)
	pending := hub.pending[connectionID]
	if pending != nil {
		delete(hub.pending, connectionID)
		pending.daemon = conn
	}
	s.mu.Unlock()
	if pending == nil || pending.client == nil {
		log.Printf("relay daemon-data unmatched server_id=%s connection_id=%s remote=%s", serverID, connectionID, conn.remoteAddr)
		conn.close()
		return
	}
	log.Printf("relay bridge open server_id=%s connection_id=%s client_remote=%s daemon_remote=%s", serverID, connectionID, pending.client.remoteAddr, conn.remoteAddr)
	bridge(pending.client, pending.daemon)
	log.Printf("relay bridge closed server_id=%s connection_id=%s", serverID, connectionID)
}

func (s *Server) removePending(serverID, connectionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	hub := s.servers[serverID]
	if hub != nil {
		delete(hub.pending, connectionID)
	}
}

func (s *Server) hubLocked(serverID string) *serverHub {
	hub := s.servers[serverID]
	if hub == nil {
		hub = &serverHub{pending: make(map[string]*pendingConn)}
		s.servers[serverID] = hub
	}
	return hub
}

func (h *serverHub) writeControl(value any) error {
	h.controlMu.Lock()
	defer h.controlMu.Unlock()
	if h.control == nil {
		return errors.New("control not connected")
	}
	return h.control.writeJSON(value)
}

func bridge(a, b *relayConn) {
	done := make(chan struct{}, 2)
	go proxy(a, b, done)
	go proxy(b, a, done)
	<-done
	a.close()
	b.close()
}

func proxy(src, dst *relayConn, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	for {
		messageType, payload, err := src.ws.ReadMessage()
		if err != nil {
			log.Printf("relay proxy read closed server_id=%s connection_id=%s src_role=%s dst_role=%s err=%v", src.serverID, src.connectionID, src.role, dst.role, err)
			return
		}
		if err := dst.writeMessage(messageType, payload); err != nil {
			log.Printf("relay proxy write failed server_id=%s connection_id=%s src_role=%s dst_role=%s err=%v", src.serverID, src.connectionID, src.role, dst.role, err)
			return
		}
	}
}

func newRelayConn(ws *websocket.Conn, role, serverID, connectionID, remoteAddr string) *relayConn {
	return &relayConn{
		ws:            ws,
		role:          role,
		serverID:      serverID,
		connectionID:  connectionID,
		remoteAddr:    remoteAddr,
		heartbeatDone: make(chan struct{}),
	}
}

func (c *relayConn) startHeartbeat() {
	ticker := time.NewTicker(relayPingPeriod)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := c.writeControl(websocket.PingMessage, nil); err != nil {
					log.Printf("relay heartbeat failed role=%s server_id=%s connection_id=%s remote=%s err=%v", c.role, c.serverID, c.connectionID, c.remoteAddr, err)
					c.close()
					return
				}
			case <-c.heartbeatDone:
				return
			}
		}
	}()
}

func (c *relayConn) writeJSON(value any) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.ws.SetWriteDeadline(time.Now().Add(relayWriteWait)); err != nil {
		return err
	}
	return c.ws.WriteJSON(value)
}

func (c *relayConn) writeMessage(messageType int, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.ws.SetWriteDeadline(time.Now().Add(relayWriteWait)); err != nil {
		return err
	}
	return c.ws.WriteMessage(messageType, payload)
}

func (c *relayConn) writeControl(messageType int, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.ws.WriteControl(messageType, payload, time.Now().Add(relayWriteWait))
}

func (c *relayConn) close() {
	c.closeOnce.Do(func() {
		close(c.heartbeatDone)
		_ = c.ws.Close()
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
