package main

import "os"

type serverConfig struct {
	StateDir       string
	RuntimeScanDir string
	Host           string
	Port           string
	AuthToken      string
}

func loadServerConfig() (serverConfig, error) {
	stateDir := os.Getenv("CREW44_STATE_DIR")
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return serverConfig{}, err
		}
		stateDir = home + "/.crew44"
	}

	runtimeScanDir := os.Getenv("CREW44_RUNTIME_SCAN_DIR")
	if runtimeScanDir == "" {
		runtimeScanDir = stateDir + "/runtime-manifests"
	}

	host := firstEnv("HOST", "CREW44_DAEMON_HOST")
	if host == "" {
		host = "127.0.0.1"
	}

	port := firstEnv("PORT", "CREW44_DAEMON_PORT")
	if port == "" {
		port = "8080"
	}

	return serverConfig{
		StateDir:       stateDir,
		RuntimeScanDir: runtimeScanDir,
		Host:           host,
		Port:           port,
		AuthToken:      firstEnv("AUTH_TOKEN", "CREW44_AUTH_TOKEN", "CREW44_API_TOKEN"),
	}, nil
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}
