package main

import (
	"log"
	"os"
)

func main() {
	logger := log.New(os.Stderr, "", log.LstdFlags)
	cfg, err := loadServerConfig()
	if err != nil {
		logger.Fatal(err)
	}
	if err := runServer(cfg, logger); err != nil {
		logger.Fatal(err)
	}
}
