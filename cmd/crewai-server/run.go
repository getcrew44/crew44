package main

import (
	"fmt"
	"log"
	"net"
	"net/http"

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

	listener, err := listenFunc("tcp", ":"+cfg.Port)
	if err != nil {
		return err
	}

	logger.Printf(
		"crewai-server listening addr=%s state_dir=%s runtime_scan_dir=%s",
		listener.Addr().String(),
		cfg.StateDir,
		cfg.RuntimeScanDir,
	)

	if err := serveFunc(listener, handler); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("serve http: %w", err)
	}
	return nil
}
