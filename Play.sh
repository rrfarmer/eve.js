#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SCRIPT="${REPO_ROOT}/tools/macos/scripts/EvEJSConfig.sh"
LAUNCH_HELPER="${REPO_ROOT}/tools/macos/launch-offline-client.sh"

if [[ ! -f "$CONFIG_SCRIPT" ]]; then
  echo "[eve.js] Missing config helper: $CONFIG_SCRIPT" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CONFIG_SCRIPT"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  exec bash "$LAUNCH_HELPER" --help
fi

if [[ ! -e "$EVEJS_MAC_STAGED_ROOT" ]]; then
  echo "[eve.js] Staged runtime not found: $EVEJS_MAC_STAGED_ROOT" >&2
  echo "[eve.js] Run the macOS setup helper first:" >&2
  echo "  bash \"$REPO_ROOT/tools/macos/StartClientSetup.sh\"" >&2
  exit 1
fi

exec bash "$LAUNCH_HELPER" \
  --staged-root "$EVEJS_MAC_STAGED_ROOT" \
  --server-host "$EVEJS_SERVER_HOST" \
  --proxy-url "$EVEJS_PROXY_URL" \
  --settings-profile "$EVEJS_MAC_SETTINGS_PROFILE" \
  "$@"
