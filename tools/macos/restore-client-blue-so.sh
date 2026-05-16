#!/usr/bin/env bash

set -euo pipefail

DEFAULT_CLIENT_ROOT="${HOME}/Library/Application Support/EVE Online"
CLIENT_ROOT="${DEFAULT_CLIENT_ROOT}"
BLUE_SO_PATH=""
EXTERNAL_BACKUP_PATH=""
RESIGN_AFTER_RESTORE=true
REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
RESIGN_HELPER="${REPO_ROOT}/tools/macos/resign-offline-client.sh"

usage() {
  cat <<'EOF'
Usage: bash tools/macos/restore-client-blue-so.sh [--client-root <dir>] [--no-resign]

Restores blue.so in the local source copy from the backup created by the
macOS blue.so patcher. This does not affect the staged runtime.

After restoring the source, rebuild the staged runtime:
  bash tools/macos/stage-offline-client.sh --clean-stage

Options:
  --client-root <dir>  Root directory containing SharedCache (source copy).
  --no-resign          Restore blue.so without re-signing the source app bundle.
  --help               Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client-root)
      CLIENT_ROOT="$2"
      shift 2
      ;;
    --no-resign)
      RESIGN_AFTER_RESTORE=false
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[eve.js] Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

BLUE_SO_PATH="${CLIENT_ROOT}/SharedCache/tq/EVE.app/Contents/Resources/build/bin64/blue.so"
EXTERNAL_BACKUP_PATH="${CLIENT_ROOT}/.evejs-backups/SharedCache/tq/EVE.app/Contents/Resources/build/bin64/blue.so.original"

for backup_path in \
  "${EXTERNAL_BACKUP_PATH}" \
  "${BLUE_SO_PATH}.original" \
  "${BLUE_SO_PATH}.evejs-original"
do
  if [[ -f "$backup_path" ]]; then
    mkdir -p "$(dirname "$BLUE_SO_PATH")"
    mv "$backup_path" "$BLUE_SO_PATH"
    echo "[eve.js] Restored blue.so in source copy from backup:"
    echo "  $BLUE_SO_PATH"
    if [[ "$RESIGN_AFTER_RESTORE" == true ]]; then
      if [[ -x "$RESIGN_HELPER" || -f "$RESIGN_HELPER" ]]; then
        bash "$RESIGN_HELPER" --client-root "$CLIENT_ROOT"
      else
        echo "[eve.js] Warning: re-sign helper not found at:"
        echo "  $RESIGN_HELPER"
        echo "[eve.js] The source app bundle will need a re-sign before it can launch cleanly."
      fi
    fi
    echo "[eve.js] Rebuild the staged runtime from the restored source:"
    echo "  bash \"$(dirname "${BASH_SOURCE[0]}")/stage-offline-client.sh\" --clean-stage"
    exit 0
  fi
done

echo "[eve.js] No blue.so backup found for:"
echo "  $BLUE_SO_PATH"
