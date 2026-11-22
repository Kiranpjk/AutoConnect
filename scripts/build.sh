#!/usr/bin/env bash
# Builds unpacked extension folders and zip files for Chrome and Firefox.
#   dist/chrome/   dist/autoconnect-chrome-<version>.zip
#   dist/firefox/  dist/autoconnect-firefox-<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest_chrome.json').version")

rm -rf dist
for target in chrome firefox; do
  out="dist/$target"
  mkdir -p "$out/icons"
  cp -r src "$out/"
  cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$out/icons/"
  cp "manifest_$target.json" "$out/manifest.json"
  (cd "$out" && zip -qr "../autoconnect-$target-$version.zip" .)
  echo "built dist/autoconnect-$target-$version.zip"
done
