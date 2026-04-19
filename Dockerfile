ARG PLUGIN_BUILD_VERSION=1.0.4
ARG PLUGIN_BUILD_DATE=2026-04-19

# Stage 1: Build frontend (TypeScript/React)
FROM node:20-alpine AS frontend-builder

WORKDIR /plugin

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps --no-audit --prefer-offline

COPY tsconfig.json ./
COPY .config/ ./.config/
COPY src/ ./src/

ARG PLUGIN_BUILD_VERSION
ARG PLUGIN_BUILD_DATE
ENV PLUGIN_BUILD_VERSION=$PLUGIN_BUILD_VERSION
ENV PLUGIN_BUILD_DATE=$PLUGIN_BUILD_DATE

RUN npm run build

# Stage 2: Build Go backend
FROM golang:1.24-alpine AS backend-builder

WORKDIR /plugin

RUN apk add --no-cache git

ENV GONOSUMDB=*
ENV GOFLAGS=-mod=mod

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY pkg/ ./pkg/

# Build for all common platforms
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -buildvcs=false \
    -ldflags="-s -w" \
    -o dist/gpx_templatehub_linux_amd64 \
    ./pkg

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build \
    -buildvcs=false \
    -ldflags="-s -w" \
    -o dist/gpx_templatehub_linux_arm64 \
    ./pkg

# Stage 3: Plugin artifact image
# This is a lightweight image containing only plugin files.
FROM busybox:stable

ARG PLUGIN_BUILD_VERSION

LABEL org.opencontainers.image.title="Template Hub Plugin"
LABEL org.opencontainers.image.description="Grafana Template Hub app plugin artifact"
LABEL org.opencontainers.image.version=$PLUGIN_BUILD_VERSION

COPY --from=frontend-builder /plugin/dist/ /plugin/greg00r-templatehub-app/
COPY --from=backend-builder /plugin/dist/ /plugin/greg00r-templatehub-app/
COPY templates/ /seed-templates/

RUN chmod +x /plugin/greg00r-templatehub-app/gpx_templatehub_linux_amd64 \
 && chmod +x /plugin/greg00r-templatehub-app/gpx_templatehub_linux_arm64

# Default command: copy plugin files to the plugins volume mount
CMD ["sh", "-c", "cp -r /plugin/. /var/lib/grafana/plugins/ && echo 'Plugin installed.'"]
