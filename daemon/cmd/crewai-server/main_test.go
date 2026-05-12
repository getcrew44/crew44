package main

import (
	"bytes"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"testing"
)

func TestRunServerLogsListeningAddress(t *testing.T) {
	t.Helper()

	origHandlerFactory := serverHandlerFactory
	origListen := listenFunc
	origServe := serveFunc
	defer func() {
		serverHandlerFactory = origHandlerFactory
		listenFunc = origListen
		serveFunc = origServe
	}()

	serverHandlerFactory = func(serverConfig) (http.Handler, error) {
		return http.NewServeMux(), nil
	}

	listenFunc = func(network, address string) (net.Listener, error) {
		return net.Listen(network, address)
	}

	serveFunc = func(listener net.Listener, handler http.Handler) error {
		_ = listener.Close()
		return nil
	}

	var logs bytes.Buffer
	logger := log.New(&logs, "", 0)

	err := runServer(serverConfig{
		StateDir:       "/tmp/crewai-state",
		RuntimeScanDir: "/tmp/crewai-state/runtime-manifests",
		Host:           "127.0.0.1",
		Port:           "0",
	}, logger)
	if err != nil {
		t.Fatalf("runServer returned error: %v", err)
	}

	output := logs.String()
	if !strings.Contains(output, "crewai-server listening") {
		t.Fatalf("expected listening log, got %q", output)
	}
	if !strings.Contains(output, "state_dir=/tmp/crewai-state") {
		t.Fatalf("expected state dir in log, got %q", output)
	}
	if !strings.Contains(output, "runtime_scan_dir=/tmp/crewai-state/runtime-manifests") {
		t.Fatalf("expected runtime scan dir in log, got %q", output)
	}
}

func TestRunServerReturnsHandlerFactoryError(t *testing.T) {
	t.Helper()

	origHandlerFactory := serverHandlerFactory
	defer func() {
		serverHandlerFactory = origHandlerFactory
	}()

	serverHandlerFactory = func(serverConfig) (http.Handler, error) {
		return nil, io.EOF
	}

	logger := log.New(io.Discard, "", 0)
	err := runServer(serverConfig{Port: "0"}, logger)
	if err == nil {
		t.Fatal("expected handler factory error")
	}
}

func TestAuthMiddlewareRequiresBearerToken(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := authMiddleware("secret", next)

	req, err := http.NewRequest(http.MethodGet, "/api/projects", nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := &statusRecorder{}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d, want %d", rec.status, http.StatusUnauthorized)
	}

	req.Header.Set("Authorization", "Bearer secret")
	rec = &statusRecorder{}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusNoContent {
		t.Fatalf("authorized status = %d, want %d", rec.status, http.StatusNoContent)
	}
}

func TestAuthMiddlewareAllowsHealth(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := authMiddleware("secret", next)

	req, err := http.NewRequest(http.MethodGet, "/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := &statusRecorder{}
	handler.ServeHTTP(rec, req)
	if rec.status != http.StatusNoContent {
		t.Fatalf("health status = %d, want %d", rec.status, http.StatusNoContent)
	}
}

func TestCorsMiddlewareAllowsLocalhostPreflight(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("preflight should not reach next handler")
	})
	handler := corsMiddleware(next)

	req, err := http.NewRequest(http.MethodOptions, "/api/projects", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:3000")
	req.Header.Set("Access-Control-Request-Headers", "authorization")

	rec := &statusRecorder{header: http.Header{}}
	handler.ServeHTTP(rec, req)

	if rec.status != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", rec.status, http.StatusNoContent)
	}
	if got := rec.header.Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:3000" {
		t.Fatalf("allow origin = %q, want localhost origin", got)
	}
	if got := rec.header.Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type" {
		t.Fatalf("allow headers = %q, want Authorization, Content-Type", got)
	}
}

func TestCorsMiddlewareAllowsFileOrigin(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := corsMiddleware(next)

	req, err := http.NewRequest(http.MethodGet, "/api/projects", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "null")

	rec := &statusRecorder{header: http.Header{}}
	handler.ServeHTTP(rec, req)

	if got := rec.header.Get("Access-Control-Allow-Origin"); got != "null" {
		t.Fatalf("allow origin = %q, want null", got)
	}
}

type statusRecorder struct {
	status int
	header http.Header
}

func (r *statusRecorder) Header() http.Header {
	if r.header == nil {
		r.header = http.Header{}
	}
	return r.header
}

func (r *statusRecorder) Write([]byte) (int, error) {
	if r.status == 0 {
		r.status = http.StatusOK
	}
	return 0, nil
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
}
