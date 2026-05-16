#!/usr/bin/env bash

set -uo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_SCRIPT="${REPO_ROOT}/tools/macos/scripts/EvEJSConfig.sh"
CA_CERT_PATH="${REPO_ROOT}/server/certs/xmpp-ca-cert.pem"
CA_KEY_PATH="${REPO_ROOT}/server/certs/xmpp-ca-key.pem"
GATEWAY_CERT_DIR="${EVEJS_GATEWAY_CERT_DIR:-${REPO_ROOT}/server/var/certs/gateway}"
GATEWAY_CERT_PATH="${EVEJS_GATEWAY_CERT_PATH:-${GATEWAY_CERT_DIR}/gateway-dev-cert.pem}"
GATEWAY_KEY_PATH="${EVEJS_GATEWAY_KEY_PATH:-${GATEWAY_CERT_DIR}/gateway-dev-key.pem}"
SERVER_PORT="${EVEJS_SERVER_PORT:-26000}"
IMAGE_PORT="${EVEJS_IMAGE_PORT:-26001}"
PROXY_PORT="${EVEJS_PROXY_PORT:-26002}"
GATEWAY_HTTPS_PORT="${EVEJS_GATEWAY_HTTPS_PORT:-26003}"
GATEWAY_HTTPS_PORT_EXPLICIT="${EVEJS_GATEWAY_HTTPS_PORT:-}"

QUIET=false
CHECK_ONLY=false
FAILURES=0
WARNINGS=0
CHECKS=0

GATEWAY_REQUIRED_DNS=(
  "dev-public-gateway.evetech.net"
  "live-public-gateway.evetech.net"
  "public-gateway.evetech.net"
  "localhost"
)

usage() {
  cat <<'EOF'
Usage: bash tools/macos/doctor.sh [--check] [--quiet] [--help]

Checks the native macOS eve.js setup without launching the EVE client.

Options:
  --check   Run read-only checks and return a test-friendly exit status.
            This is the default behavior; the flag keeps future smoke tests
            explicit.
  --quiet   Suppress output. Exit code is still 0 when ready and non-zero when
            required checks fail.
  --help    Show this help text.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=true
      shift
      ;;
    --quiet)
      QUIET=true
      CHECK_ONLY=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[eve.js] Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -f "$CONFIG_SCRIPT" ]]; then
  # shellcheck disable=SC1090
  . "$CONFIG_SCRIPT"
else
  EVEJS_MAC_RETAIL_ROOT="${EVEJS_MAC_RETAIL_ROOT:-${HOME}/Library/Application Support/EVE Online}"
  EVEJS_MAC_SOURCE_ROOT="${EVEJS_MAC_SOURCE_ROOT:-${HOME}/Library/Application Support/eve.js/macos/source-client}"
  EVEJS_MAC_STAGED_BASE="${EVEJS_MAC_STAGED_BASE:-${HOME}/Library/Application Support/eve.js/macos/staged-client}"
  EVEJS_MAC_STAGED_ROOT="${EVEJS_MAC_STAGED_ROOT:-${EVEJS_MAC_STAGED_BASE}/current}"
  EVEJS_MAC_SESSION_FILE="${EVEJS_MAC_SESSION_FILE:-${HOME}/Library/Application Support/eve.js/macos/launcher-session.args}"
fi
SESSION_FILE="${EVEJS_MAC_SESSION_FILE:-${HOME}/Library/Application Support/eve.js/macos/launcher-session.args}"

url_port_or_default() {
  local url="${1:-}"
  local fallback="$2"

  if [[ "$url" =~ :([0-9]+)(/|$) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi

  printf '%s' "$fallback"
}

IMAGE_PORT="$(url_port_or_default "${EVEJS_IMAGE_SERVER_URL:-}" "$IMAGE_PORT")"
PROXY_PORT="$(url_port_or_default "${EVEJS_MICROSERVICES_REDIRECT_URL:-${EVEJS_MICROSERVICES_PUBLIC_BASE_URL:-}}" "$PROXY_PORT")"
if [[ -z "$GATEWAY_HTTPS_PORT_EXPLICIT" && "$PROXY_PORT" =~ ^[0-9]+$ ]]; then
  GATEWAY_HTTPS_PORT=$((PROXY_PORT + 1))
fi

print_header() {
  if [[ "$QUIET" == true || "$CHECK_ONLY" == true ]]; then
    return
  fi

  echo "[eve.js] macOS doctor"
  echo "[eve.js] Repo: $REPO_ROOT"
  echo
}

record() {
  local level="$1"
  local name="$2"
  local detail="$3"
  local remediation="${4:-}"

  CHECKS=$((CHECKS + 1))
  case "$level" in
    FAIL)
      FAILURES=$((FAILURES + 1))
      ;;
    WARN)
      WARNINGS=$((WARNINGS + 1))
      ;;
  esac

  if [[ "$QUIET" == true ]]; then
    return
  fi

  printf '%-4s %s\n' "$level" "$name"
  if [[ -n "$detail" ]]; then
    printf '     %s\n' "$detail"
  fi
  if [[ -n "$remediation" ]]; then
    printf '     fix: %s\n' "$remediation"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

display_path() {
  local path="$1"
  printf '%s' "${path/#$HOME/~}"
}

file_mode() {
  local path="$1"
  stat -f "%Lp" "$path" 2>/dev/null || stat -c "%a" "$path" 2>/dev/null || true
}

mode_is_private() {
  local mode="$1"
  local numeric=0

  [[ "$mode" =~ ^[0-7]+$ ]] || return 1
  numeric=$((8#$mode))
  (( (numeric & 077) == 0 ))
}

check_platform() {
  local platform=""
  platform="$(uname -s 2>/dev/null || true)"
  if [[ "$platform" == "Darwin" ]]; then
    record PASS "Platform" "macOS detected."
  else
    record FAIL "Platform" "Expected macOS, got '${platform:-unknown}'." "Run the native macOS workflow on a Mac."
  fi
}

check_command() {
  local name="$1"
  local remediation="$2"

  if command_exists "$name"; then
    record PASS "Command: $name" "$(command -v "$name")"
  else
    record FAIL "Command: $name" "Missing required command." "$remediation"
  fi
}

check_required_commands() {
  check_command node "Install Node.js, then rerun this doctor."
  check_command npm "Install npm with Node.js, then rerun this doctor."
  check_command openssl "Install OpenSSL or ensure it is on PATH."
  check_command python3 "Install Python 3; macOS staging metadata checks need it."
  check_command ditto "Run on macOS or install the Apple command line tools."
  check_command xattr "Run on macOS or install the Apple command line tools."
  check_command codesign "Install the Apple command line tools."
  check_command security "Run on macOS; CA trust checks need the security tool."
}

check_retail_root() {
  local shared_cache="${EVEJS_MAC_RETAIL_ROOT}/SharedCache"
  local app_bundle="${shared_cache}/tq/EVE.app"

  if [[ -d "$shared_cache" && -d "$app_bundle" ]]; then
    record PASS "Retail EVE root" "$(display_path "$EVEJS_MAC_RETAIL_ROOT")"
  elif [[ -d "$shared_cache" ]]; then
    record FAIL "Retail EVE root" "SharedCache exists but tq/EVE.app was not found under $(display_path "$shared_cache")." "Pass --retail-root to tools/macos/StartClientSetup.sh or set EVEJS_MAC_RETAIL_ROOT."
  else
    record FAIL "Retail EVE root" "Missing SharedCache under $(display_path "$EVEJS_MAC_RETAIL_ROOT")." "Install EVE Online, or run: bash tools/macos/StartClientSetup.sh --retail-root <path>"
  fi
}

check_source_copy() {
  local shared_cache="${EVEJS_MAC_SOURCE_ROOT}/SharedCache"
  local app_bundle="${shared_cache}/tq/EVE.app"
  local start_ini="${app_bundle}/Contents/Resources/build/start.ini"

  if [[ -d "$shared_cache" && -d "$app_bundle" && -f "$start_ini" ]]; then
    record PASS "Prepared source copy" "$(display_path "$EVEJS_MAC_SOURCE_ROOT")"
  else
    record FAIL "Prepared source copy" "Missing prepared source client at $(display_path "$EVEJS_MAC_SOURCE_ROOT")." "Run: bash tools/macos/StartClientSetup.sh"
  fi
}

read_stage_metadata() {
  local metadata_path="$1"

  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(d.get('stageVersion', ''))
print(d.get('build', ''))
print(d.get('patchState', ''))
print('1' if d.get('bootCommonOverlay', False) else '0')
print(d.get('bootCryptoPack', '') or '')
print(d.get('appBundleSignatureMode', '') or '')
print(d.get('resfilesMode', '') or '')
print(d.get('entrypoint', '') or '')
print(d.get('sourceRoot', '') or '')
" "$metadata_path" 2>/dev/null
}

check_staged_runtime() {
  local metadata_path="${EVEJS_MAC_STAGED_ROOT}/.evejs-stage-metadata.json"
  local app_bundle="${EVEJS_MAC_STAGED_ROOT}/SharedCache/tq/EVE.app"
  local exefile="${app_bundle}/Contents/Resources/build/bin64/exefile"
  local metadata=""
  local stage_version=""
  local build=""
  local patch_state=""
  local boot_overlay=""
  local boot_crypto_pack=""
  local app_signature_mode=""
  local resfiles_mode=""
  local entrypoint=""
  local source_root=""
  local resfiles_link="${EVEJS_MAC_STAGED_ROOT}/SharedCache/ResFiles"

  if [[ ! -e "$EVEJS_MAC_STAGED_ROOT" ]]; then
    record FAIL "Staged runtime" "Missing staged runtime: $(display_path "$EVEJS_MAC_STAGED_ROOT")." "Run: bash tools/macos/StartClientSetup.sh"
    return
  fi

  if [[ ! -d "$app_bundle" || ! -f "$exefile" ]]; then
    record FAIL "Staged runtime" "Staged tree is missing EVE.app or build/bin64/exefile." "Rebuild: bash tools/macos/StartClientSetup.sh"
    return
  fi

  if [[ ! -f "$metadata_path" ]]; then
    record FAIL "Stage metadata" "Missing $(display_path "$metadata_path")." "Rebuild: bash tools/macos/StartClientSetup.sh"
    return
  fi

  if ! command_exists python3; then
    record FAIL "Stage metadata" "Cannot parse stage metadata without python3." "Install Python 3."
    return
  fi

  metadata="$(read_stage_metadata "$metadata_path")"
  if [[ -z "$metadata" ]]; then
    record FAIL "Stage metadata" "Could not parse $(display_path "$metadata_path")." "Rebuild: bash tools/macos/StartClientSetup.sh"
    return
  fi

  stage_version="$(echo "$metadata" | sed -n '1p')"
  build="$(echo "$metadata" | sed -n '2p')"
  patch_state="$(echo "$metadata" | sed -n '3p')"
  boot_overlay="$(echo "$metadata" | sed -n '4p')"
  boot_crypto_pack="$(echo "$metadata" | sed -n '5p')"
  app_signature_mode="$(echo "$metadata" | sed -n '6p')"
  resfiles_mode="$(echo "$metadata" | sed -n '7p')"
  entrypoint="$(echo "$metadata" | sed -n '8p')"
  source_root="$(echo "$metadata" | sed -n '9p')"

  if [[ "$stage_version" != "2" ]]; then
    record WARN "Stage metadata" "Unexpected stageVersion '${stage_version:-missing}' for build ${build:-unknown}." "Rebuild with current tools/macos/StartClientSetup.sh."
  else
    record PASS "Stage metadata" "build=${build:-unknown} patch=${patch_state:-unknown} entrypoint=${entrypoint:-unknown} resfiles=${resfiles_mode:-unknown}"
  fi

  if [[ "$resfiles_mode" == "symlink" && -L "$resfiles_link" && ! -d "$resfiles_link" ]]; then
    record FAIL "Staged ResFiles" "ResFiles symlink target is unavailable. Source was: ${source_root:-unknown}." "Restore the source copy or rebuild with --copy-resfiles."
  else
    record PASS "Staged runtime" "$(display_path "$EVEJS_MAC_STAGED_ROOT")"
  fi

  check_boot_overlay "$app_bundle" "$boot_overlay" "$boot_crypto_pack" "$app_signature_mode"
}

read_ini_value() {
  local path="$1"
  local wanted_key="$2"
  local line=""
  local trimmed=""
  local key=""
  local normalized_key=""
  local value=""

  [[ -f "$path" ]] || return 1
  wanted_key="$(printf '%s' "$wanted_key" | tr '[:upper:]' '[:lower:]')"

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    case "$trimmed" in
      ""|\#*|\;*|\[*)
        continue
        ;;
    esac
    [[ "$trimmed" == *"="* ]] || continue
    key="${trimmed%%=*}"
    normalized_key="${key//[[:space:]]/}"
    normalized_key="$(printf '%s' "$normalized_key" | tr '[:upper:]' '[:lower:]')"
    [[ "$normalized_key" == "$wanted_key" ]] || continue
    value="${trimmed#*=}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
    return 0
  done < "$path"

  return 1
}

check_boot_overlay() {
  local app_bundle="$1"
  local metadata_overlay="$2"
  local metadata_crypto="$3"
  local app_signature_mode="$4"
  local common_ini="${app_bundle}/Contents/Resources/build/common.ini"
  local crypto_pack=""

  if [[ -f "$common_ini" ]]; then
    crypto_pack="$(read_ini_value "$common_ini" "cryptoPack" || true)"
    if grep -Eq '^; Generated by eve.js (launch|stage)-offline-client\.sh$' "$common_ini"; then
      record PASS "Boot overlay" "generated common.ini cryptoPack=${crypto_pack:-unknown}; app seal=${app_signature_mode:-unknown}"
    else
      record WARN "Boot overlay" "Non-generated common.ini exists at $(display_path "$common_ini")." "Inspect or rebuild the staged runtime before launch."
    fi
    return
  fi

  if [[ "$metadata_overlay" == "1" ]]; then
    record FAIL "Boot overlay" "Stage metadata expects common.ini cryptoPack=${metadata_crypto:-Placebo}, but the file is missing." "Rebuild: bash tools/macos/StartClientSetup.sh"
  else
    record PASS "Boot overlay" "No generated common.ini overlay recorded."
  fi
}

check_session_file() {
  local mode=""

  if [[ ! -f "$SESSION_FILE" ]]; then
    record FAIL "Launcher session" "Missing launcher-session args file: $(display_path "$SESSION_FILE")." "Run: bash tools/macos/capture-launcher-session.sh"
    return
  fi

  mode="$(file_mode "$SESSION_FILE")"
  if [[ -n "$mode" ]] && ! mode_is_private "$mode"; then
    record FAIL "Launcher session permissions" "Mode $mode is too open for private session material." "Run: chmod 600 \"$(display_path "$SESSION_FILE")\""
  else
    record PASS "Launcher session permissions" "Mode ${mode:-unknown}; file is private."
  fi

  if grep -q '^/ssoToken=' "$SESSION_FILE" &&
    grep -q '^/refreshToken=' "$SESSION_FILE" &&
    grep -q '^/LauncherData=' "$SESSION_FILE"; then
    record PASS "Launcher session args" "Required private launcher args are present."
  else
    record FAIL "Launcher session args" "Missing /ssoToken, /refreshToken, or /LauncherData." "Re-capture: bash tools/macos/capture-launcher-session.sh"
  fi
}

check_local_ca() {
  local verify_output=""

  if [[ ! -f "$CA_CERT_PATH" || ! -f "$CA_KEY_PATH" ]]; then
    record FAIL "Local CA files" "Missing CA cert or key under server/certs." "Restore server/certs/xmpp-ca-*.pem from the repo."
    return
  fi

  record PASS "Local CA files" "$(display_path "$CA_CERT_PATH")"

  if ! command_exists security; then
    record FAIL "Local CA trust" "Cannot check login-keychain trust without security." "Run on macOS, then: bash tools/macos/install-local-ca.sh"
    return
  fi

  if [[ -f "$GATEWAY_CERT_PATH" ]]; then
    verify_output="$(
      security verify-cert \
        -c "$GATEWAY_CERT_PATH" \
        -p ssl \
        -n live-public-gateway.evetech.net \
        -L 2>&1 || true
    )"
  else
    verify_output="$(security verify-cert -c "$CA_CERT_PATH" -p ssl -l -L 2>&1 || true)"
  fi

  if [[ "$verify_output" == *"Cert Verify Result: No error."* ]]; then
    record PASS "Local CA trust" "Gateway leaf verifies through the current trust settings."
  else
    record FAIL "Local CA trust" "Gateway leaf did not verify through current trust settings." "Run: bash tools/macos/install-local-ca.sh"
  fi
}

check_gateway_cert() {
  local san_output=""
  local subject_output=""
  local missing=()
  local dns=""

  if [[ ! -f "$GATEWAY_CERT_PATH" || ! -f "$GATEWAY_KEY_PATH" ]]; then
    record FAIL "Gateway certificate" "Missing runtime cert/key under $(display_path "$GATEWAY_CERT_DIR")." "Run: bash QuickstartServer.sh"
    return
  fi

  if ! command_exists openssl; then
    record FAIL "Gateway certificate" "Cannot inspect certificate without openssl." "Install OpenSSL or ensure it is on PATH."
    return
  fi

  san_output="$(openssl x509 -in "$GATEWAY_CERT_PATH" -noout -ext subjectAltName 2>/dev/null || true)"
  subject_output="$(openssl x509 -in "$GATEWAY_CERT_PATH" -noout -subject -nameopt RFC2253 2>/dev/null || true)"

  for dns in "${GATEWAY_REQUIRED_DNS[@]}"; do
    if [[ "$san_output" != *"DNS:${dns}"* ]]; then
      missing+=("$dns")
    fi
  done

  if [[ "$san_output" != *"IP Address:127.0.0.1"* && "$san_output" != *"IP:127.0.0.1"* ]]; then
    missing+=("127.0.0.1")
  fi

  if [[ "$subject_output" != *"CN=live-public-gateway.evetech.net"* ]]; then
    missing+=("CN=live-public-gateway.evetech.net")
  fi

  if (( ${#missing[@]} > 0 )); then
    record FAIL "Gateway certificate SANs" "Missing: ${missing[*]}" "Delete $(display_path "$GATEWAY_CERT_DIR") and run: bash QuickstartServer.sh"
  else
    record PASS "Gateway certificate SANs" "$(display_path "$GATEWAY_CERT_PATH")"
  fi
}

check_port() {
  local label="$1"
  local port="$2"
  local output=""

  if ! command_exists lsof; then
    record WARN "Port: $label" "Cannot inspect port $port without lsof." "Install lsof or check manually."
    return
  fi

  output="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$output" ]]; then
    record WARN "Port: $label" "Port $port is already listening. This is OK if eve.js is already running." "Stop the conflicting process or override the related EVEJS_* port env var."
  else
    record PASS "Port: $label" "Port $port is free."
  fi
}

check_ports() {
  check_port "game server" "$SERVER_PORT"
  check_port "image server" "$IMAGE_PORT"
  check_port "HTTP proxy" "$PROXY_PORT"
  check_port "local gateway HTTPS" "$GATEWAY_HTTPS_PORT"
}

check_proxy_defaults() {
  local configured="${EVEJS_PROXY_ALLOWED_HOSTS:-}"
  local config_path="${REPO_ROOT}/server/src/config/index.js"

  if [[ "$configured" == *"clientresources.eveonline.com"* ]]; then
    record PASS "Proxy CDN allow-list" "EVEJS_PROXY_ALLOWED_HOSTS includes clientresources.eveonline.com."
    return
  fi

  if [[ -z "$configured" ]] && grep -q 'defaultValue: "clientresources.eveonline.com"' "$config_path"; then
    record PASS "Proxy CDN allow-list" "Default config allows clientresources.eveonline.com."
    return
  fi

  record FAIL "Proxy CDN allow-list" "clientresources.eveonline.com is not allowed by current proxy defaults." "Unset EVEJS_PROXY_ALLOWED_HOSTS or include clientresources.eveonline.com."
}

print_summary() {
  if [[ "$QUIET" == true ]]; then
    return
  fi

  echo
  if (( FAILURES > 0 )); then
    echo "[eve.js] Doctor found $FAILURES failure(s), $WARNINGS warning(s), $CHECKS check(s)."
  else
    echo "[eve.js] Doctor passed required checks with $WARNINGS warning(s), $CHECKS check(s)."
  fi
}

print_header
check_platform
check_required_commands
check_retail_root
check_source_copy
check_staged_runtime
check_session_file
check_local_ca
check_gateway_cert
check_ports
check_proxy_defaults
print_summary

if (( FAILURES > 0 )); then
  exit 1
fi
exit 0
