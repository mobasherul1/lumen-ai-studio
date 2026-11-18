#!/bin/bash
# Install Lumen AI Studio as an UNSIGNED development extension on macOS.
# 1. Copies the extension into ~/Library/Application Support/Adobe/CEP/extensions/lumen-ai-studio
# 2. Sets PlayerDebugMode=1 for CSXS 10/11/12 (per-user plists) so unsigned panels load.
#    Mapping: IL 2021 v25.0 -> CEP 10, v25.3..v28 -> CEP 11, 2025 v29 -> CEP 12.
# 3. Restart Illustrator, then Window -> Extensions -> Lumen AI Studio
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/lumen-ai-studio"

echo "== Lumen AI Studio - unsigned dev install (macOS) =="
echo "Source : $SRC"
echo "Target : $DEST"

rm -rf "$DEST"
mkdir -p "$DEST"
# copy everything except dev-only folders
( cd "$SRC" && tar --exclude='./build' --exclude='./.git' --exclude='./node_modules' -cf - . ) | ( cd "$DEST" && tar -xf - )

for v in 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode -string 1
  echo "PlayerDebugMode=1 -> com.adobe.CSXS.$v"
done

# macOS 10.9+ caches preferences - cfprefsd must restart before the host notices
killall cfprefsd 2>/dev/null || true

echo ""
echo "Done. Restart Illustrator, then: Window -> Extensions -> Lumen AI Studio"
echo "(If it still does not appear, log out and back in so the plist cache fully resets.)"
