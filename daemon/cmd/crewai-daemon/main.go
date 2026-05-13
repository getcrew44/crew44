package main

import (
	"log"
	"os"
)

func main() {
	logger := log.New(os.Stderr, "", log.LstdFlags)
	if fields := currentBuildMetadata().LogFields(); fields != "" {
		logger.Printf("crewai-daemon build %s", fields)
	}
	cfg, err := loadServerConfig()
	if err != nil {
		logger.Fatal(err)
	}
	if err := runServer(cfg, logger); err != nil {
		logger.Fatal(err)
	}
}
