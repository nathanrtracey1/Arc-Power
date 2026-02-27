#!/usr/bin/env bash
# Create a DMG for Arc Power (macOS Safari extension host app).
# Run from the repository root. Requires Xcode and a valid signing setup.
#
# Usage: ./scripts/create-dmg.sh [version]
#   version  Optional (e.g. 1.0). Defaults to 1.0.

set -e

VERSION="${1:-1.0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGED_DIR="$REPO_ROOT/ArcifySafari-Packaged/Arc Power"
PROJECT="$PACKAGED_DIR/Arc Power.xcodeproj"
BUILD_DIR="$PACKAGED_DIR/build"
DMG_NAME="Arc-Power-${VERSION}"
STAGING_DIR="$BUILD_DIR/dmg-staging"

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

echo "Creating DMG..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

DMG_PATH="$REPO_ROOT/${DMG_NAME}.dmg"
rm -f "$DMG_PATH"

hdiutil create -volname "Arc Power" \
  -srcfolder "$STAGING_DIR" \
  -ov -format UDZO \
  "$DMG_PATH"

rm -rf "$STAGING_DIR"
echo "Done: $DMG_PATH"
