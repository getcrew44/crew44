package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/sqtech/crew-ai/crewai-repo/internal/httpapi"
)

var (
	serverHandlerFactory = func(cfg serverConfig) (http.Handler, error) {
		return httpapi.NewServer(httpapi.ServerConfig{
			StateDir:       cfg.StateDir,
			RuntimeScanDir: cfg.RuntimeScanDir,
		})
	}
	listenFunc = func(network, address string) (net.Listener, error) {
		return net.Listen(network, address)
	}
	serveFunc = func(listener net.Listener, handler http.Handler) error {
		server := &http.Server{Handler: handler}
		return server.Serve(listener)
	}
)

func runServer(cfg serverConfig, logger *log.Logger) error {
	handler, err := serverHandlerFactory(cfg)
	if err != nil {
		return err
	}
	handler = corsMiddleware(authMiddleware(cfg.AuthToken, handler))

	listenAddr := net.JoinHostPort(cfg.Host, cfg.Port)
	listener, err := listenFunc("tcp", listenAddr)
	if err != nil {
		return err
	}

	logger.Printf(
		"crewai-server listening addr=%s state_dir=%s runtime_scan_dir=%s auth=%t",
		listener.Addr().String(),
		cfg.StateDir,
		cfg.RuntimeScanDir,
		cfg.AuthToken != "",
	)

	if err := serveFunc(listener, handler); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("serve http: %w", err)
	}
	return nil
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if isAllowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.Header().Add("Vary", "Origin")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	if origin == "null" || origin == "file://" {
		return true
	}
	return strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://localhost:")
}

func authMiddleware(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			next.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
