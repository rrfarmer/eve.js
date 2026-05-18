#!/usr/bin/env bash

set -euo pipefail

DEFAULT_BLUE_SO="${HOME}/Library/Application Support/eve.js/macos/source-client/SharedCache/tq/EVE.app/Contents/Resources/build/bin64/blue.so"
BLUE_SO="${DEFAULT_BLUE_SO}"
OUT_DIR=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/survey-blue-so-crypto.sh [options]

Runs a focused static survey over stock macOS blue.so for crypto/auth research.
The script is read-only and writes filtered outputs to an artifact directory.

Options:
  --blue-so <path>   blue.so path. Default:
                     ~/Library/Application Support/eve.js/macos/source-client/SharedCache/tq/EVE.app/Contents/Resources/build/bin64/blue.so
  --out <dir>        Output directory. Default:
                     /tmp/evejs-blue-so-crypto-survey-<timestamp>
  --help            Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --blue-so)
      BLUE_SO="$2"
      shift 2
      ;;
    --out)
      OUT_DIR="$2"
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

if [[ ! -f "$BLUE_SO" ]]; then
  echo "[eve.js] blue.so not found: $BLUE_SO" >&2
  exit 1
fi

if [[ -z "$OUT_DIR" ]]; then
  OUT_DIR="/tmp/evejs-blue-so-crypto-survey-$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$OUT_DIR"

echo "[eve.js] blue.so: $BLUE_SO"
echo "[eve.js] output:  $OUT_DIR"

file "$BLUE_SO" >"$OUT_DIR/blue-stock-file.txt" 2>&1 || true
otool -L "$BLUE_SO" >"$OUT_DIR/blue-stock-linked-libs.txt" 2>&1 || true
otool -Iv "$BLUE_SO" \
  | egrep '(^|[[:space:]])_(EVP|AES|DES|RC4|SHA|MD5|HMAC|RAND|RSA|BIO|BN|CRYPTO|SSL|TLS)' \
  >"$OUT_DIR/blue-stock-crypto-imports.txt" 2>&1 || true
nm -m "$BLUE_SO" 2>/dev/null \
  | c++filt \
  | egrep '(^|[[:space:]])_(EVP|AES|DES|RC4|SHA|MD5|HMAC|RAND|RSA|BIO|BN|CRYPTO|SSL|TLS)|LoadKey|cryptoPack|Placebo|marshal|auth|session|macho|packet' \
  >"$OUT_DIR/blue-stock-crypto-symbols.txt" 2>&1 || true
strings -a "$BLUE_SO" \
  | egrep -i 'LoadKey|cryptoPack|Placebo|EVP|AES|auth|authenticate|macho|marshal|session|key|iv|password|token' \
  >"$OUT_DIR/blue-stock-interesting-strings.txt" 2>&1 || true

{
  echo "### FILE"
  cat "$OUT_DIR/blue-stock-file.txt"
  echo
  echo "### LINKED LIBRARIES"
  cat "$OUT_DIR/blue-stock-linked-libs.txt"
  echo
  echo "### CRYPTO IMPORTS"
  sed -n '1,160p' "$OUT_DIR/blue-stock-crypto-imports.txt"
  echo
  echo "### INTERESTING SYMBOLS"
  sed -n '1,160p' "$OUT_DIR/blue-stock-crypto-symbols.txt"
  echo
  echo "### INTERESTING STRINGS"
  sed -n '1,160p' "$OUT_DIR/blue-stock-interesting-strings.txt"
} >"$OUT_DIR/summary.txt"

cat "$OUT_DIR/summary.txt"
echo "[eve.js] Wrote static survey artifacts to: $OUT_DIR"
