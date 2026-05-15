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
		StateDir:       "/tmp/crew44-state",
		RuntimeScanDir: "/tmp/crew44-state/runtime-manifests",
		Host:           "127.0.0.1",
		Port:           "0",
	}, logger)
	if err != nil {
		t.Fatalf("runServer returned error: %v", err)
	}

	output := logs.String()
	if !strings.Contains(output, "crew44-daemon listening") {
		t.Fatalf("expected listening log, got %q", output)
	}
	if !strings.Contains(output, "state_dir=/tmp/crew44-state") {
		t.Fatalf("expected state dir in log, got %q", output)
	}
	if !strings.Contains(output, "runtime_scan_dir=/tmp/crew44-state/runtime-manifests") {
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
