#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CA_CERT_PATH="${REPO_ROOT}/server/certs/xmpp-ca-cert.pem"
LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"
MODE="install"

usage() {
  cat <<'EOF'
Usage: bash tools/macos/install-local-ca.sh [--remove]

Installs or removes the eve.js local CA in the current user's login keychain.
This lets the stock macOS client trust the local gateway TLS cert without
modifying EVE.app.

Options:
  --remove   Remove the CA trust entry from the user keychain.
  --help     Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove)
      MODE="remove"
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

if [[ ! -f "$CA_CERT_PATH" ]]; then
  echo "[eve.js] Missing CA certificate: $CA_CERT_PATH" >&2
  exit 1
fi

if ! command -v security >/dev/null 2>&1; then
  echo "[eve.js] Missing required command: security" >&2
  exit 1
fi

if [[ "$MODE" == "remove" ]]; then
  security remove-trusted-cert "$CA_CERT_PATH"
  echo "[eve.js] Removed eve.js CA trust from the user keychain."
  exit 0
fi

security add-trusted-cert \
  -r trustRoot \
  -p ssl \
  -k "$LOGIN_KEYCHAIN" \
  "$CA_CERT_PATH"

echo "[eve.js] Installed eve.js CA trust in the user keychain for SSL."
