#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PLUGIN_ID="gregoor-private-marketplace-app"
PACKAGE_JSON="$REPO_ROOT/package.json"
DIST_DIR="$REPO_ROOT/dist"
ARTIFACTS_DIR="$REPO_ROOT/.artifacts"
PACKAGE_ROOT="$ARTIFACTS_DIR/$PLUGIN_ID"
RELEASES_DIR="$ARTIFACTS_DIR/releases"

PACKAGE_VERSION="${1:-${PLUGIN_BUILD_VERSION:-}}"
if [[ -z "$PACKAGE_VERSION" ]]; then
  PACKAGE_VERSION="$(node -p "require('$PACKAGE_JSON').version")"
fi

BUILD_DATE="${PLUGIN_BUILD_DATE:-$(date +%F)}"
ARCHIVE_NAME="${PLUGIN_ID}-${PACKAGE_VERSION}.zip"
ARCHIVE_PATH="$RELEASES_DIR/$ARCHIVE_NAME"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

log() {
  printf '>> [%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

command -v node >/dev/null 2>&1 || { echo "node is required" >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required" >&2; exit 1; }
command -v go >/dev/null 2>&1 || { echo "go is required" >&2; exit 1; }
command -v zip >/dev/null 2>&1 || { echo "zip is required" >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo "sha256sum is required" >&2; exit 1; }

rm -rf "$PACKAGE_ROOT" "$ARCHIVE_PATH" "$CHECKSUM_PATH"
mkdir -p "$PACKAGE_ROOT" "$RELEASES_DIR"

log "Building frontend bundle version $PACKAGE_VERSION"
(
  cd "$REPO_ROOT"
  PLUGIN_BUILD_VERSION="$PACKAGE_VERSION" PLUGIN_BUILD_DATE="$BUILD_DATE" npm run build
)

log "Copying frontend assets"
cp -R "$DIST_DIR/." "$PACKAGE_ROOT/"

log "Building linux/amd64 backend binary"
(
  cd "$REPO_ROOT"
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -buildvcs=false \
    -ldflags="-s -w" \
    -o "$PACKAGE_ROOT/gpx_private_marketplace_linux_amd64" \
    ./pkg
)

log "Building linux/arm64 backend binary"
(
  cd "$REPO_ROOT"
  CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build \
    -buildvcs=false \
    -ldflags="-s -w" \
    -o "$PACKAGE_ROOT/gpx_private_marketplace_linux_arm64" \
    ./pkg
)

chmod +x "$PACKAGE_ROOT/gpx_private_marketplace_linux_amd64" "$PACKAGE_ROOT/gpx_private_marketplace_linux_arm64"

log "Creating release archive $ARCHIVE_NAME"
(
  cd "$ARTIFACTS_DIR"
  zip -rq "$ARCHIVE_PATH" "$PLUGIN_ID"
)

sha256sum "$ARCHIVE_PATH" > "$CHECKSUM_PATH"

log "Package ready:"
printf '   %s\n' "$ARCHIVE_PATH"
printf '   %s\n' "$CHECKSUM_PATH"
