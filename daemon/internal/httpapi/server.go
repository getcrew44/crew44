package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/sqtech/crew-ai/crewai-repo/internal/app"
	"github.com/sqtech/crew-ai/crewai-repo/internal/rpc"
	"github.com/sqtech/crew-ai/crewai-repo/internal/runtime"
)

type ServerConfig struct {
	StateDir       string
	RuntimeScanDir string
	Scanner        runtime.Scanner
	Engine         runtime.Engine
	AuthToken      string
}

type Server struct {
	app *app.App
	rpc *rpc.Server
	mux *http.ServeMux
}

func NewServer(cfg ServerConfig) (http.Handler, error) {
	application, err := app.New(app.Config{
		StateDir:       cfg.StateDir,
		RuntimeScanDir: cfg.RuntimeScanDir,
		Scanner:        cfg.Scanner,
		Engine:         cfg.Engine,
	})
	if err != nil {
		return nil, err
	}

	server := &Server{
		app: application,
		rpc: rpc.NewServer(rpc.Config{
			App:       application,
			AuthToken: cfg.AuthToken,
		}),
		mux: http.NewServeMux(),
	}
	server.routes()
	return server, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
	})
	s.mux.Handle("GET /rpc", s.rpc)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
