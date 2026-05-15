package main

import (
	"fmt"
	"log"
	"net"
	"net/http"

	"github.com/getcrew44/crew44/daemon/internal/httpapi"
)

var (
	serverHandlerFactory = func(cfg serverConfig) (http.Handler, error) {
		return httpapi.NewServer(httpapi.ServerConfig{
			StateDir:       cfg.StateDir,
			RuntimeScanDir: cfg.RuntimeScanDir,
			AuthToken:      cfg.AuthToken,
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

	listenAddr := net.JoinHostPort(cfg.Host, cfg.Port)
	listener, err := listenFunc("tcp", listenAddr)
	if err != nil {
		return err
	}

	logger.Printf(
		"crew44-daemon listening addr=%s state_dir=%s runtime_scan_dir=%s auth=%t",
		listener.Addr().String(),
		cfg.StateDir,
		cfg.RuntimeScanDir,
		cfg.AuthToken != "",
	)

	if err := serveFunc(listener, handler); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("serve daemon transport: %w", err)
	}
	return nil
}
