#!/usr/bin/env bash

set -euo pipefail

DEFAULT_CLIENT_ROOT="${HOME}/Library/Application Support/EVE Online"
CLIENT_ROOT="${DEFAULT_CLIENT_ROOT}"
APP_BUNDLE=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/restore-client-cacert.sh [--client-root <dir>]

Restores experimental cacert.pem backups inside the copied EVE.app bundle from
older Mac tests. The current Mac workflow should not patch these files because
the native manifest verifier rejects the modified bundle.

Options:
  --client-root <dir>  Root directory containing SharedCache.
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

APP_BUNDLE="${CLIENT_ROOT}/SharedCache/tq/EVE.app"

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "[eve.js] App bundle not found: $APP_BUNDLE" >&2
  exit 1
fi

targets=(
  "${APP_BUNDLE}/Contents/Resources/build/bin64/cacert.pem"
  "${APP_BUNDLE}/Contents/Resources/build/bin64/packages/certifi/cacert.pem"
)

restored=0

for target in "${targets[@]}"; do
  backup="${target}.evejs-original"
  if [[ ! -f "$backup" ]]; then
    continue
  fi

  mv "$backup" "$target"
  restored=$((restored + 1))
  echo "[eve.js] Restored: $target"
done

if (( restored == 0 )); then
  echo "[eve.js] No backups found — nothing to restore."
else
  echo "[eve.js] Restored $restored file(s) to their original state."
fi
