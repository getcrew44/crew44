package main

import (
	"log"
	"net/http"
	"os"

	"github.com/sqtech/crew-ai/crewai-repo/internal/httpapi"
)

func main() {
	stateDir := os.Getenv("CREWAI_STATE_DIR")
	if stateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
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

	handler, err := httpapi.NewServer(httpapi.ServerConfig{
		StateDir:       stateDir,
		RuntimeScanDir: runtimeScanDir,
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
