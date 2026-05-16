#!/usr/bin/env bash

set -euo pipefail

DEFAULT_CLIENT_ROOT="${HOME}/Library/Application Support/EVE Online"
CLIENT_ROOT="${DEFAULT_CLIENT_ROOT}"
START_INI_PATH=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/restore-client-startini.sh [--client-root <dir>]

Restores start.ini in the local source copy from the backup created by
prepare-offline-client.sh. This does not affect the staged runtime.

After restoring the source, rebuild the staged runtime:
  bash tools/macos/stage-offline-client.sh --clean-stage

Options:
  --client-root <dir>  Root directory containing SharedCache (source copy).
  --help               Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --client-root)
      CLIENT_ROOT="$2"
      shift 2
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

START_INI_PATH="${CLIENT_ROOT}/SharedCache/tq/EVE.app/Contents/Resources/build/start.ini"
BACKUP_PATH="${CLIENT_ROOT}/.evejs-backups/SharedCache/tq/EVE.app/Contents/Resources/build/start.ini.evejs-original"

if [[ ! -f "$BACKUP_PATH" ]]; then
  legacy_backup="${START_INI_PATH}.evejs-original"
  if [[ -f "$legacy_backup" ]]; then
    BACKUP_PATH="$legacy_backup"
  else
    echo "[eve.js] No start.ini backup found at: $BACKUP_PATH"
    exit 0
  fi
fi

mv "$BACKUP_PATH" "$START_INI_PATH"
echo "[eve.js] Restored start.ini from backup:"
echo "  $START_INI_PATH"
