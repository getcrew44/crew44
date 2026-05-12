BIN_DIR := bin
CLI_BIN := $(BIN_DIR)/crewai-cli
SERVER_BIN := $(BIN_DIR)/crewai-server

.PHONY: help fmt test build build-cli build-server build-frontend build-electron electron e2e ui-e2e clean

help:
	@printf '%s\n' \
		'make fmt          - gofmt CLI/server/internal packages' \
		'make test         - run go test ./...' \
		'make build        - build server, cli, frontend, and Electron app' \
		'make build-cli    - build bin/crewai-cli' \
		'make build-server - build bin/crewai-server' \
		'make build-frontend - build frontend dist/' \
		'make build-electron - build frontend dist/ and local Electron app' \
		'make electron     - run local Electron app' \
		'make e2e          - run API end-to-end suite' \
		'make ui-e2e       - prepare and open the Electron UI e2e harness' \
		'make clean        - remove local build artifacts'

fmt:
	gofmt -w $$(find cmd internal test-utils -name '*.go' -type f)

test:
	go test ./...

build: build-cli build-server build-electron

build-cli:
	mkdir -p $(BIN_DIR)
	go build -o $(CLI_BIN) ./cmd/crewai-cli

build-server:
	mkdir -p $(BIN_DIR)
	go build -o $(SERVER_BIN) ./cmd/crewai-server

build-frontend:
	cd frontend && npm run build

build-electron:
	cd frontend && npm run build:electron

electron:
	cd frontend && npm run electron

e2e:
	./test-utils/api-e2e.sh all

ui-e2e:
	./test-utils/ui-e2e.sh all

clean:
	rm -rf $(BIN_DIR)
	rm -f crewai-cli crewai-server
	rm -rf frontend/dist frontend/.electron-app
