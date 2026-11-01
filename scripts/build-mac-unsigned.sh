#!/bin/sh
# Builds unsigned macOS zips (arm64 + x64) on Linux/WSL, where electron-builder cannot build for
# macOS. Same file names as the release build (the updater looks for them). The app is not signed:
# on the Mac it has to be allowed once, see README (the updater signs updates ad hoc itself).
# Needs build/icon.icns (npm run icon, e.g. on Windows) and the zip command.
set -e

here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"
version=$(node -p "require('./package.json').version")
out="dist/mac-unsigned"
rm -rf "$out"

cat >build/Info-extra.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>LSUIElement</key><true/>
<key>NSAppleEventsUsageDescription</key><string>Farmies holt das Terminal-Fenster der Claude-Code-Session nach vorne.</string></dict></plist>
EOF

npx @electron/packager . "Farmies" --platform=darwin --arch=arm64,x64 --asar --overwrite \
  --out="$out" --icon=build/icon.icns --app-bundle-id=com.gustganz.farmies \
  --extend-info=build/Info-extra.plist \
  --ignore='^/(dist|build|scripts|\.git|\.gitignore|README\.md)($|/)'

for arch in arm64 x64; do
  (cd "$out/Farmies-darwin-$arch" && zip -qry "../../Farmies-$version-mac-$arch.zip" "Farmies.app")
done
rm -rf "$out"
ls -la dist/Farmies-"$version"-mac-*.zip
