BIN_DIR := bin
CLI_BIN := $(BIN_DIR)/crewai-cli
DAEMON_BIN := $(BIN_DIR)/crewai-daemon

.PHONY: help fmt test build build-cli build-daemon dev daemon\:dev electron electron\:dev electron\:build e2e ui-e2e clean

help:
	@printf '%s\n' \
		'make fmt            - gofmt daemon packages' \
		'make test           - run daemon Go tests and renderer tests' \
		'make build          - build daemon, CLI, renderer, and Electron app' \
		'make build-cli    - build bin/crewai-cli' \
		'make build-daemon - build bin/crewai-daemon' \
		'make daemon:dev   - run the Go daemon on HOST/PORT or 127.0.0.1:8080' \
		'make dev          - run Vite for pure browser development' \
		'make electron:dev - build daemon, run Vite, and launch Electron' \
		'make electron:build - build daemon, renderer, and local Electron app' \
		'make electron     - run local packaged Electron app' \
		'make e2e          - run API end-to-end suite' \
		'make ui-e2e       - prepare and open the Electron UI e2e harness' \
		'make clean        - remove local build artifacts'

fmt:
	cd daemon && gofmt -w $$(find cmd internal test-utils -name '*.go' -type f)

test:
	cd daemon && go test ./...
	npm test

build: build-cli electron\:build

build-cli:
	mkdir -p $(BIN_DIR)
	cd daemon && go build -o ../$(CLI_BIN) ./cmd/crewai-cli

build-daemon:
	mkdir -p $(BIN_DIR)
	cd daemon && go build -o ../$(DAEMON_BIN) ./cmd/crewai-daemon

daemon\:dev:
	cd daemon && go run ./cmd/crewai-daemon

dev:
	npm run dev

electron\:dev: build-daemon
	npm run electron:dev

electron\:build: build-daemon
	npm run build:electron

electron:
	npm run electron

e2e:
	./test-utils/api-e2e.sh all

ui-e2e:
	./test-utils/ui-e2e.sh all

clean:
	rm -rf $(BIN_DIR)
	rm -f crewai-cli crewai-server crewai-daemon
	rm -rf dist .electron-app
