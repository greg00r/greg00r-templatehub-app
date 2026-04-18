# ── Stage 1: Build frontend (TypeScript/React) ────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /plugin

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY .config/ ./.config/
COPY src/ ./src/

RUN npm run build

# ── Stage 2: Build Go backend ─────────────────────────────────────────────────
FROM golang:1.21-alpine AS backend-builder

WORKDIR /plugin

RUN apk add --no-cache git

ENV GONOSUMDB=*
ENV GOFLAGS=-mod=mod

COPY go.mod ./
COPY pkg/ ./pkg/

RUN go mod tidy

# Build for all common platforms
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w" \
    -o dist/gpx_private_marketplace_linux_amd64 \
    ./pkg

RUN CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build \
    -ldflags="-s -w" \
    -o dist/gpx_private_marketplace_linux_arm64 \
    ./pkg

# ── Stage 3: Plugin artifact image ────────────────────────────────────────────
# This is a lightweight image containing ONLY the plugin files.
# Used as an init container in Kubernetes to inject the plugin into Grafana.
#
# Usage as init container:
#   image: gregoor/private-marketplace-plugin:1.0.0
#   command: ["sh", "-c", "cp -r /plugin/. /var/lib/grafana/plugins/gregoor-private-marketplace-app/"]
#
FROM busybox:stable

LABEL org.opencontainers.image.title="Private Marketplace Plugin"
LABEL org.opencontainers.image.description="Grafana App Plugin – init container artifact"
LABEL org.opencontainers.image.version="1.0.0"

COPY --from=frontend-builder /plugin/dist/ /plugin/gregoor-private-marketplace-app/
COPY --from=backend-builder  /plugin/dist/ /plugin/gregoor-private-marketplace-app/
COPY templates/ /seed-templates/

RUN chmod +x /plugin/gregoor-private-marketplace-app/gpx_private_marketplace_linux_amd64 \
 && chmod +x /plugin/gregoor-private-marketplace-app/gpx_private_marketplace_linux_arm64

# Default command: copy plugin files to the plugins volume mount
CMD ["sh", "-c", "cp -r /plugin/. /var/lib/grafana/plugins/ && echo 'Plugin installed.'"]
