package rpc

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/sqtech/crew-ai/crewai-repo/internal/app"
)

const (
	ProtocolV1     = "crewai.rpc.v1"
	tokenPrefix    = "crewai.bearer."
	writeQueueSize = 64
)

var errMethodNotFound = errors.New("method not found")

type Server struct {
	app       *app.App
	authToken string
	methods   map[string]methodHandler
	upgrader  websocket.Upgrader
}

type Config struct {
	App       *app.App
	AuthToken string
}

type Peer interface {
	Notify(method string, params any) bool
	AddSubscription(id string, cancel func())
	RemoveSubscription(id string) bool
}

func NewServer(cfg Config) *Server {
	server := &Server{
		app:       cfg.App,
		authToken: cfg.AuthToken,
		upgrader: websocket.Upgrader{
			Subprotocols: []string{ProtocolV1},
			CheckOrigin:  func(*http.Request) bool { return true },
		},
	}
	server.registerMethods()
	return server
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := s.authorize(r); err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	ws, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	conn := NewConn(ws)
	conn.Run(r.Context(), s)
}

func (s *Server) authorize(r *http.Request) error {
	protocols := websocket.Subprotocols(r)
	hasProtocol := false
	hasToken := s.authToken == ""
	for _, protocol := range protocols {
		if protocol == ProtocolV1 {
			hasProtocol = true
			continue
		}
		if strings.HasPrefix(protocol, tokenPrefix) && strings.TrimPrefix(protocol, tokenPrefix) == s.authToken {
			hasToken = true
		}
	}
	if !hasProtocol {
		return errors.New("missing rpc subprotocol")
	}
	if !hasToken {
		return errors.New("unauthorized")
	}
	return nil
}

type Conn struct {
	ws            *websocket.Conn
	outbox        chan any
	done          chan struct{}
	closeOnce     sync.Once
	subMu         sync.Mutex
	subscriptions map[string]func()
}

func NewConn(ws *websocket.Conn) *Conn {
	return &Conn{
		ws:            ws,
		outbox:        make(chan any, writeQueueSize),
		done:          make(chan struct{}),
		subscriptions: make(map[string]func()),
	}
}

func (c *Conn) Run(ctx context.Context, server *Server) {
	writerDone := make(chan struct{})
	go c.writeLoop(writerDone)
	defer func() {
		c.close()
		<-writerDone
	}()

	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		var req Request
		if err := json.Unmarshal(data, &req); err != nil {
			c.send(newErrorResponse(nil, rpcError(CodeParseError, "parse error")))
			continue
		}

		if len(req.ID) == 0 {
			go func() {
				_, _ = server.Handle(ctx, c, req)
			}()
			continue
		}
		if req.JSONRPC != Version || req.Method == "" {
			c.send(newErrorResponse(req.ID, rpcError(CodeInvalidRequest, "invalid request")))
			continue
		}

		go func(req Request) {
			result, err := server.Handle(ctx, c, req)
			if errors.Is(err, errMethodNotFound) {
				c.send(newErrorResponse(req.ID, rpcError(CodeMethodNotFound, "method not found")))
				return
			}
			if err != nil {
				rpcErr := mapError(err)
				if errors.Is(err, errInvalidParams) {
					rpcErr = rpcError(CodeInvalidParams, err.Error())
				}
				c.send(newErrorResponse(req.ID, rpcErr))
				return
			}
			c.send(newResultResponse(req.ID, result))
		}(req)
	}
}

func (c *Conn) Notify(method string, params any) bool {
	return c.send(notification(method, params))
}

func (c *Conn) send(value any) bool {
	select {
	case <-c.done:
		return false
	case c.outbox <- value:
		return true
	}
}

func (c *Conn) writeLoop(done chan<- struct{}) {
	defer close(done)
	for {
		select {
		case <-c.done:
			return
		case value := <-c.outbox:
			if err := c.ws.WriteJSON(value); err != nil {
				c.close()
				return
			}
		}
	}
}

func (c *Conn) AddSubscription(id string, cancel func()) {
	c.subMu.Lock()
	defer c.subMu.Unlock()
	c.subscriptions[id] = cancel
}

func (c *Conn) RemoveSubscription(id string) bool {
	c.subMu.Lock()
	cancel := c.subscriptions[id]
	if cancel != nil {
		delete(c.subscriptions, id)
	}
	c.subMu.Unlock()
	if cancel != nil {
		cancel()
		return true
	}
	return false
}

func (c *Conn) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		c.subMu.Lock()
		for id, cancel := range c.subscriptions {
			delete(c.subscriptions, id)
			cancel()
		}
		c.subMu.Unlock()
		_ = c.ws.Close()
	})
}
