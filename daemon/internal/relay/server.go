package relay

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/getcrew44/crew44/daemon/internal/id"
)

type Server struct {
	mu       sync.Mutex
	servers  map[string]*serverHub
	upgrader websocket.Upgrader
}

type serverHub struct {
	control   *websocket.Conn
	controlMu sync.Mutex
	pending   map[string]*pendingConn
}

type pendingConn struct {
	client *websocket.Conn
	daemon *websocket.Conn
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
	if serverID == "" {
		http.Error(w, "server_id is required", http.StatusBadRequest)
		return
	}
	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	switch role {
	case "daemon-control":
		s.serveControl(serverID, ws)
	case "client":
		s.serveClient(serverID, ws)
	case "daemon-data":
		s.serveDaemonData(serverID, r.URL.Query().Get("connection_id"), ws)
	default:
		_ = ws.Close()
	}
}

func (s *Server) serveControl(serverID string, ws *websocket.Conn) {
	s.mu.Lock()
	hub := s.hubLocked(serverID)
	if hub.control != nil {
		_ = hub.control.Close()
	}
	hub.control = ws
	s.mu.Unlock()

	for {
		if _, _, err := ws.ReadMessage(); err != nil {
			s.mu.Lock()
			if s.servers[serverID] == hub && hub.control == ws {
				hub.control = nil
			}
			s.mu.Unlock()
			_ = ws.Close()
			return
		}
	}
}

func (s *Server) serveClient(serverID string, ws *websocket.Conn) {
	connectionID := "conn_" + id.New()
	pending := &pendingConn{client: ws}

	s.mu.Lock()
	hub := s.hubLocked(serverID)
	hub.pending[connectionID] = pending
	s.mu.Unlock()

	if hub.writeControl(map[string]any{"type": "client_connected", "connection_id": connectionID}) != nil {
		s.removePending(serverID, connectionID)
		_ = ws.Close()
		return
	}
}

func (s *Server) serveDaemonData(serverID, connectionID string, ws *websocket.Conn) {
	if connectionID == "" {
		_ = ws.Close()
		return
	}
	s.mu.Lock()
	hub := s.hubLocked(serverID)
	pending := hub.pending[connectionID]
	if pending != nil {
		delete(hub.pending, connectionID)
		pending.daemon = ws
	}
	s.mu.Unlock()
	if pending == nil || pending.client == nil {
		_ = ws.Close()
		return
	}
	bridge(pending.client, pending.daemon)
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
	return h.control.WriteJSON(value)
}

func bridge(a, b *websocket.Conn) {
	done := make(chan struct{}, 2)
	go proxy(a, b, done)
	go proxy(b, a, done)
	<-done
	_ = a.Close()
	_ = b.Close()
}

func proxy(src, dst *websocket.Conn, done chan<- struct{}) {
	defer func() { done <- struct{}{} }()
	for {
		messageType, payload, err := src.ReadMessage()
		if err != nil {
			return
		}
		if err := dst.WriteMessage(messageType, payload); err != nil {
			return
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
