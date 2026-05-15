package main

import (
	"log"
	"net"
	"net/http"
	"os"

	"github.com/getcrew44/crew44/daemon/internal/relay"
)

func main() {
	host := firstEnv("HOST", "CREW44_RELAY_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := firstEnv("PORT", "CREW44_RELAY_PORT")
	if port == "" {
		port = "8090"
	}
	addr := net.JoinHostPort(host, port)
	log.Printf("crew44-relay listening addr=%s", addr)
	if err := http.ListenAndServe(addr, relay.NewServer()); err != nil {
		log.Fatal(err)
	}
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	return ""
}
