#!/bin/sh
#
# Builds the release app and replaces the copy in /Applications with it, then
# opens it. Quits a running copy first, since its binary is about to be swapped.
#
#   npm run install:app

set -eu
cd "$(dirname "$0")/.."

APP="Déjà.app"
BUILT="src-tauri/target/release/bundle/macos/$APP"
DEST="/Applications/$APP"

npx tauri build --bundles app

osascript -e 'tell application id "com.retry.deja" to quit' >/dev/null 2>&1 || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pgrep -x deja >/dev/null || break
  sleep 0.5
done
pkill -x deja 2>/dev/null || true

rm -rf "$DEST"
cp -R "$BUILT" "$DEST"
xattr -cr "$DEST"
open "$DEST"
echo "installed $DEST"
