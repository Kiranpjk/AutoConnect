#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# LPU AutoConnect — Browser Switch Script
#
# Switches the active manifest.json between Chrome/Edge (MV3) and Firefox (MV2).
#
# Usage:
#   ./switch-browser.sh chrome    # Use Chrome/Edge manifest (MV3)
#   ./switch-browser.sh firefox   # Use Firefox manifest (MV2)
#   ./switch-browser.sh status    # Show which manifest is active
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$SCRIPT_DIR/manifest.json"
CHROME_MANIFEST="$SCRIPT_DIR/manifest_chrome.json"
FIREFOX_MANIFEST="$SCRIPT_DIR/manifest_firefox.json"

case "${1:-status}" in
  chrome|chromium|edge)
    if [ -f "$CHROME_MANIFEST" ]; then
      cp "$CHROME_MANIFEST" "$MANIFEST"
      echo "✓ Switched to Chrome/Edge manifest (MV3)"
    else
      echo "Chrome manifest backup not found."
      echo "The current manifest.json is likely already the Chrome version."
    fi
    ;;

  firefox|ff|gecko)
    # Backup current manifest as Chrome version if not already backed up
    if [ ! -f "$CHROME_MANIFEST" ]; then
      cp "$MANIFEST" "$CHROME_MANIFEST"
      echo "  Backed up current manifest.json → manifest_chrome.json"
    fi
    cp "$FIREFOX_MANIFEST" "$MANIFEST"
    echo "✓ Switched to Firefox manifest (MV2)"
    ;;

  status|info)
    if grep -q '"manifest_version": 3' "$MANIFEST" 2>/dev/null; then
      echo "Active: Chrome/Edge (Manifest V3)"
    elif grep -q '"manifest_version": 2' "$MANIFEST" 2>/dev/null; then
      echo "Active: Firefox (Manifest V2)"
    else
      echo "Unknown manifest version"
    fi
    ;;

  *)
    echo "Usage: $0 {chrome|firefox|status}"
    echo ""
    echo "  chrome  - Switch to Chrome/Edge Manifest V3"
    echo "  firefox - Switch to Firefox Manifest V2"
    echo "  status  - Show which manifest is currently active"
    exit 1
    ;;
esac
