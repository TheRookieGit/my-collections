#!/bin/sh
# Build MyCollections.app with SwiftPM (Command Line Tools are enough) and install it.
#   scripts/build-app.sh            -> build + install to /Applications/ahomemade
#   INSTALL_DIR=... scripts/build-app.sh
set -e
cd "$(dirname "$0")/.."

INSTALL_DIR="${INSTALL_DIR:-/Applications/ahomemade}"
NAME="MyCollections"
APP="build/$NAME.app"
VERSION="0.1.0"

swift build -c release --product "$NAME"
rm -rf "${APP:?}"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp ".build/release/$NAME" "$APP/Contents/MacOS/$NAME"

ICONSET=build/AppIcon.iconset
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256; do
    sips -z "$SIZE" "$SIZE" ../apple-touch-icon.png --out "$ICONSET/icon_${SIZE}x${SIZE}.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$NAME</string>
    <key>CFBundleDisplayName</key><string>My Collections</string>
    <key>CFBundleIdentifier</key><string>com.therookiegit.MyCollections</string>
    <key>CFBundleExecutable</key><string>$NAME</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

xattr -cr "$APP"
# A stable identity keeps the login item across rebuilds. Reuses AutoReceipt's signing keychain, as the other apps do.
KEYCHAIN="${SIGN_KEYCHAIN:-$HOME/Library/Keychains/autoreceipt-signing.keychain-db}"
IDENTITY="-"
SIGN_ARGS=""
if [ -f "$KEYCHAIN" ]; then
    security unlock-keychain -p "" "$KEYCHAIN" 2>/dev/null || true
    HASH="$(security find-identity -p codesigning "$KEYCHAIN" | awk '/"AutoReceipt Build Signing"/ {print $2; exit}')"
    if [ -n "$HASH" ]; then IDENTITY="$HASH"; SIGN_ARGS="--keychain $KEYCHAIN"; fi
fi
# shellcheck disable=SC2086
codesign --force --deep $SIGN_ARGS --sign "$IDENTITY" "$APP"

mkdir -p "$INSTALL_DIR"
rm -rf "${INSTALL_DIR:?}/${NAME:?}.app"
cp -R "$APP" "$INSTALL_DIR/$NAME.app"
echo "Installed $INSTALL_DIR/$NAME.app"
