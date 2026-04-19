# Plugin ID and binary name (must match executable in plugin.json)
PLUGIN_ID     := greg00r-templatehub-app
BINARY_NAME   := gpx_templatehub
OUTPUT_DIR    := dist
IMAGE_NAME    ?= greg00r/templatehub-plugin
IMAGE_TAG     ?= 1.0.0

.PHONY: build build-backend build-backend-darwin build-frontend image package lint \
        test-backend test-frontend test clean

## Build everything (frontend + backend)
build: build-frontend build-backend

## Build the Go backend for Linux/amd64 (used inside the plugin artifact image)
build-backend:
	@echo ">> Building Go backend..."
	GOOS=linux GOARCH=amd64 go build \
		-buildvcs=false \
		-o $(OUTPUT_DIR)/$(BINARY_NAME)_linux_amd64 \
		./pkg
	@echo ">> Backend binary: $(OUTPUT_DIR)/$(BINARY_NAME)_linux_amd64"

## Build for macOS (local testing with Grafana on macOS)
build-backend-darwin:
	@echo ">> Building Go backend for macOS..."
	GOOS=darwin GOARCH=arm64 go build \
		-buildvcs=false \
		-o $(OUTPUT_DIR)/$(BINARY_NAME)_darwin_arm64 \
		./pkg
	GOOS=darwin GOARCH=amd64 go build \
		-buildvcs=false \
		-o $(OUTPUT_DIR)/$(BINARY_NAME)_darwin_amd64 \
		./pkg

## Build the TypeScript/React frontend
build-frontend:
	@echo ">> Building frontend..."
	npm run build

## Build the plugin artifact image used by the sibling grafana-local repo
image:
	@echo ">> Building plugin image $(IMAGE_NAME):$(IMAGE_TAG)..."
	docker build -t $(IMAGE_NAME):$(IMAGE_TAG) .

## Build a GitHub release zip that can be unpacked directly into /var/lib/grafana/plugins
package:
	@echo ">> Building distributable plugin package..."
	bash scripts/package-plugin.sh

## Lint + typecheck
lint:
	npm run typecheck
	npm run lint
	go vet ./...

## Run Go tests
test-backend:
	go test ./pkg/...

## Run Jest tests
test-frontend:
	npm run test:ci

## Run all tests
test: test-backend test-frontend

## Clean build artifacts
clean:
	rm -rf $(OUTPUT_DIR)
	go clean -cache
