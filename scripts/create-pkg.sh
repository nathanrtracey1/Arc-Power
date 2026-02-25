#!/usr/bin/env bash
# Create a PKG installer for Arc Power (macOS Safari extension host app).
# Run from the repository root. Requires Xcode and optional signing.
#
# Usage: ./scripts/create-pkg.sh [version]
#   version  Optional (e.g. 1.0). Defaults to 1.0.

set -e

VERSION="${1:-1.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGED_DIR="$REPO_ROOT/ArcifySafari-Packaged/Arcify Safari"
PROJECT="$PACKAGED_DIR/Arc Power.xcodeproj"
BUILD_DIR="$PACKAGED_DIR/build"
PKG_NAME="Arc-Power-${VERSION}"

echo "Building Arc Power (Release)..."
cd "$PACKAGED_DIR"
xcodebuild -project "Arc Power.xcodeproj" \
  -target "Arc Power" \
  -configuration Release \
  -derivedDataPath "$BUILD_DIR" \
  build

APP_PATH="$BUILD_DIR/Build/Products/Release/Arc Power.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Build failed: $APP_PATH not found." >&2
  exit 1
fi

# pkgbuild needs a directory containing the app at the install path
STAGING_DIR="$BUILD_DIR/pkg-root/Applications"
rm -rf "$BUILD_DIR/pkg-root"
mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/"

PKG_PATH="$REPO_ROOT/${PKG_NAME}.pkg"
rm -f "$PKG_PATH"

# Identifier should match your app's bundle ID or a parent (e.g. com.yourcompany.ArcPower)
# Use a generic one for the open-source default; distributors can re-sign with their ID.
pkgbuild --identifier "io.arcpower.app" \
  --version "$VERSION" \
  --root "$BUILD_DIR/pkg-root" \
  --install-location "/" \
  "$PKG_PATH"

rm -rf "$BUILD_DIR/pkg-root"
echo "Done: $PKG_PATH"
