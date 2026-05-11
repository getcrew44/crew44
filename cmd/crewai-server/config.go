package main

import "os"

type serverConfig struct {
	StateDir       string
	RuntimeScanDir string
	Port           string
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return serverConfig{
		StateDir:       stateDir,
		RuntimeScanDir: runtimeScanDir,
		Port:           port,
	}, nil
}
