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
	stateDir := os.Getenv("CREWAI_STATE_DIR")
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return serverConfig{}, err
		}
		stateDir = home + "/.crewai"
	}

	runtimeScanDir := os.Getenv("CREWAI_RUNTIME_SCAN_DIR")
	if runtimeScanDir == "" {
		runtimeScanDir = stateDir + "/runtime-manifests"
	}

	host := firstEnv("HOST", "CREWAI_DAEMON_HOST")
	if host == "" {
		host = "127.0.0.1"
	}

	port := firstEnv("PORT", "CREWAI_DAEMON_PORT")
	if port == "" {
		port = "8080"
	}

	return serverConfig{
		StateDir:       stateDir,
		RuntimeScanDir: runtimeScanDir,
		Host:           host,
		Port:           port,
		AuthToken:      firstEnv("AUTH_TOKEN", "CREWAI_AUTH_TOKEN", "CREWAI_API_TOKEN"),
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
