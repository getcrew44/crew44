BIN_DIR := bin
CLI_BIN := $(BIN_DIR)/crewai-cli
SERVER_BIN := $(BIN_DIR)/crewai-server

.PHONY: help fmt test build build-cli build-server e2e clean

help:
	@printf '%s\n' \
		'make fmt          - gofmt CLI/server/internal packages' \
		'make test         - run go test ./...' \
		'make build        - build server and cli into bin/' \
		'make build-cli    - build bin/crewai-cli' \
		'make build-server - build bin/crewai-server' \
		'make e2e          - run API end-to-end suite' \
		'make clean        - remove local build artifacts'

fmt:
	gofmt -w $$(find cmd internal test-utils -name '*.go' -type f)

test:
	go test ./...

build: build-cli build-server

build-cli:
	mkdir -p $(BIN_DIR)
	go build -o $(CLI_BIN) ./cmd/crewai-cli

build-server:
	mkdir -p $(BIN_DIR)
	go build -o $(SERVER_BIN) ./cmd/crewai-server

e2e:
	./test-utils/api-e2e.sh all

clean:
	rm -rf $(BIN_DIR)
	rm -f crewai-cli crewai-server
