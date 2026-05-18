#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_SCRIPT="${REPO_ROOT}/tools/macos/scripts/EvEJSConfig.sh"

if [[ -f "$CONFIG_SCRIPT" ]]; then
  # shellcheck disable=SC1090
  . "$CONFIG_SCRIPT"
fi

DEFAULT_STAGED_BASE="${EVEJS_MAC_STAGED_BASE:-${HOME}/Library/Application Support/eve.js/macos/staged-client}"
DEFAULT_CAPTURE_DIR="${HOME}/Library/Application Support/eve.js/macos"
DEFAULT_SESSION_FILE="${EVEJS_MAC_SESSION_FILE:-${DEFAULT_CAPTURE_DIR}/launcher-session.args}"
DEFAULT_CA_BUNDLE_PATH="${DEFAULT_CAPTURE_DIR}/client-ca-bundle.pem"
DEFAULT_CLIENT_STDOUT_PATH="${DEFAULT_CAPTURE_DIR}/client-stdout.log"
DEFAULT_CLIENT_STDERR_PATH="${DEFAULT_CAPTURE_DIR}/client-stderr.log"
DEFAULT_RUNTIME_PATCH_LOG_PATH="${DEFAULT_CAPTURE_DIR}/runtime-blue-so-patch.jsonl"
BLUE_SO_PATCHER="${REPO_ROOT}/tools/macos/blue_so_patch.py"
RUNTIME_PATCH_HELPER="${REPO_ROOT}/tools/macos/runtime_blue_so_patch.py"
RESIGN_HELPER="${REPO_ROOT}/tools/macos/resign-offline-client.sh"
STAGE_HELPER="${REPO_ROOT}/tools/macos/stage-offline-client.sh"
RESTORE_BLUE_SO_HELPER="${REPO_ROOT}/tools/macos/restore-client-blue-so.sh"

# Primary: staged runtime
STAGED_ROOT=""
STAGED_ROOT_EXPLICIT=false

# Legacy/debug: direct client root
CLIENT_ROOT=""
CLIENT_ROOT_EXPLICIT=false
DEFAULT_CLIENT_ROOT="${HOME}/Library/Application Support/EVE Online"

APP_BUNDLE=""
APP_WRAPPER_BINARY=""
CLIENT_EXEFILE=""
CLIENT_EXEFILE_DIR=""
CLIENT_BUILD_DIR=""
CLIENT_BLUE_SO=""
LAUNCH_ENTRYPOINT_MODE="exefile"
ENTRYPOINT_EXPLICIT=false
CA_CERT_PATH="${REPO_ROOT}/server/certs/xmpp-ca-cert.pem"
CA_BUNDLE_PATH="${DEFAULT_CA_BUNDLE_PATH}"
PROXY_URL="${EVEJS_PROXY_URL:-http://127.0.0.1:26002}"
SERVER_HOST="${EVEJS_SERVER_HOST:-127.0.0.1}"
SETTINGS_PROFILE="${EVEJS_MAC_SETTINGS_PROFILE:-EvEJSLocal}"
LANGUAGE="en"
SESSION_FILE=""
CLIENT_STDOUT_PATH="${DEFAULT_CLIENT_STDOUT_PATH}"
CLIENT_STDERR_PATH="${DEFAULT_CLIENT_STDERR_PATH}"
GRPC_DEBUG=false
INSPECT_BLUE_SO=true
RUNTIME_PATCH_BLUE_SO=false
RUNTIME_PATCH_LOG_PATH="${DEFAULT_RUNTIME_PATCH_LOG_PATH}"
RUNTIME_PATCH_WAIT_SECONDS=30
GRPC_TRACE_VALUE="handshaker,transport_security,secure_endpoint,http,client_channel"
BOOT_COMMON_OVERLAY=false
BOOT_COMMON_OVERLAY_EXPLICIT=false
BOOT_CRYPTO_PACK="Placebo"
BOOT_COMMON_INI_PATH=""
START_INI_CRYPTO_PACK=""
DRY_RUN=false
FORCE=false
LAUNCH_ARGS=()
ENV_VARS=()

# Stage metadata (read from .evejs-stage-metadata.json)
STAGE_META_BUILD=""
STAGE_META_PATCH_STATE=""
STAGE_META_SIGNED=""
STAGE_META_SIGN_TIME=""
STAGE_META_SIGN_MODE=""
STAGE_META_SIGN_IDENTITY=""
STAGE_META_EXEFILE_ENTITLEMENTS_MODE=""
STAGE_META_BOOT_COMMON_OVERLAY=""
STAGE_META_BOOT_CRYPTO_PACK=""
STAGE_META_APP_BUNDLE_SIGNATURE_MODE=""
STAGE_META_RESFILES_MODE=""
STAGE_META_ENTRYPOINT=""
STAGE_META_SOURCE_ROOT=""
BLUE_SO_INSPECTION_STATE=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/launch-offline-client.sh [options]

Launches a staged native-mac EVE runtime against a local eve.js server.

The recommended Mac workflow is:
  1. prepare a local source copy (prepare-offline-client.sh)
  2. stage a launchable runtime locally (stage-offline-client.sh)
  3. launch the staged runtime (this script)

The staged runtime is the active local launch target. The source copy is never
launched directly.

Default launch entrypoint is build/bin64/exefile, executed directly with
explicit cwd, args, and env. Use the wrapper only for controlled fallback
tests.

Options:
  --staged-root <dir>        Root of the staged runtime. Default:
                             ~/...eve.js/macos/staged-client/current
  --server-host <host>       Hostname or IP passed as /server:... to EVE.
  --proxy-url <url>          Local proxy URL used for HTTPS interception.
  --settings-profile <name>  Client settings profile name. Default: EvEJSLocal
  --language <code>          Client language code. Default: en
  --session-file <path>      Launcher-session args file from capture-launcher-session.sh.
  --use-captured-session     Use the default captured launcher-session args file.
  --direct-exefile           Explicitly launch build/bin64/exefile. This is the
                             default and is kept as a compatibility alias.
  --app-wrapper              Launch Contents/MacOS/EVE instead of exefile.
  --grpc-debug               Enable gRPC debug env vars and capture stdout/stderr.
  --client-stdout <path>     Stdout log path for --grpc-debug.
  --client-stderr <path>     Stderr log path for --grpc-debug.
  --grpc-trace <value>       Override the grpc trace selector list.
  --runtime-patch-blue-so    Research mode. Apply the recorded blue.so patch in
                             memory after launch instead of mutating bundle
                             bytes on disk. Requires Frida and direct exefile
                             launch. Retail hardened builds may still reject
                             debugger attach.
  --runtime-patch-log <path> JSONL log path for the runtime patch helper.
  --skip-blue-so-inspect     Skip exact-build blue.so inspection output.
  --boot-common-overlay      Write/refresh a staged common.ini boot overlay so
                             eveprefs can override start.ini cryptoPack.
  --no-boot-common-overlay   Disable the common.ini boot overlay. This is the
                             default and keeps the staged app bundle untouched.
  --boot-crypto-pack <value> cryptoPack value used for the compatibility launch
                             arg and, when --boot-common-overlay is enabled,
                             the generated common.ini overlay. Default: Placebo.
  --force                    Skip stage metadata verification. Use with caution.
  --dry-run                  Print the final launch command without launching.
  --client-root <dir>        [legacy/debug] Launch directly from a client root
                             instead of a staged runtime. Not recommended.
  --help                     Show this help text.
EOF
}

trim_leading_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "$value"
}

trim_trailing_whitespace() {
  local value="$1"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

read_ini_value() {
  local path="$1"
  local wanted_key="$2"
  local line=""
  local trimmed=""
  local key=""
  local normalized_key=""
  local value=""

  if [[ ! -f "$path" ]]; then
    return 1
  fi

  wanted_key="$(printf '%s' "$wanted_key" | tr '[:upper:]' '[:lower:]')"

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="$(trim_leading_whitespace "$line")"
    case "$trimmed" in
      ""|\#*|\;*|\[*)
        continue
        ;;
    esac

    if [[ "$trimmed" != *"="* ]]; then
      continue
    fi

    key="${trimmed%%=*}"
    normalized_key="${key//[[:space:]]/}"
    normalized_key="$(printf '%s' "$normalized_key" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized_key" != "$wanted_key" ]]; then
      continue
    fi

    value="${trimmed#*=}"
    value="$(trim_leading_whitespace "$value")"
    value="$(trim_trailing_whitespace "$value")"
    printf '%s' "$value"
    return 0
  done < "$path"

  return 1
}

upsert_arg() {
  local prefix="$1"
  local replacement="$2"
  local updated=()
  local arg=""
  local found=false

  if (( ${#LAUNCH_ARGS[@]} > 0 )); then
    for arg in "${LAUNCH_ARGS[@]}"; do
      if [[ "$arg" == "$prefix"* ]]; then
        if [[ "$found" == false ]]; then
          updated+=("$replacement")
          found=true
        fi
        continue
      fi
      updated+=("$arg")
    done
  fi

  if [[ "$found" == false ]]; then
    updated+=("$replacement")
  fi

  LAUNCH_ARGS=("${updated[@]}")
}

build_external_ca_bundle() {
  local source_bundle="${APP_BUNDLE}/Contents/Resources/build/bin64/cacert.pem"
  local temp_bundle=""

  if [[ ! -f "$source_bundle" ]]; then
    echo "[eve.js] Stock client CA bundle not found: $source_bundle" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$CA_BUNDLE_PATH")"
  temp_bundle="${CA_BUNDLE_PATH}.tmp"

  cp "$source_bundle" "$temp_bundle"
  printf '\n' >>"$temp_bundle"
  cat "$CA_CERT_PATH" >>"$temp_bundle"
  mv "$temp_bundle" "$CA_BUNDLE_PATH"
}

is_generated_boot_common_overlay() {
  local path="$1"

  [[ -f "$path" ]] && grep -Eq '^; Generated by eve.js (launch|stage)-offline-client\.sh$' "$path"
}

remove_generated_boot_common_overlay() {
  local path="${CLIENT_BUILD_DIR}/common.ini"

  if is_generated_boot_common_overlay "$path"; then
    if ! rm -f "$path"; then
      echo "[eve.js] Failed to remove previous generated boot overlay:" >&2
      echo "  $path" >&2
      echo "[eve.js] Re-stage the runtime if macOS is denying writes inside EVE.app." >&2
      return 1
    fi
  fi
}

write_boot_common_overlay() {
  local temp_path=""
  local existing_crypto_pack=""

  BOOT_COMMON_INI_PATH="${CLIENT_BUILD_DIR}/common.ini"

  if [[ "$BOOT_COMMON_OVERLAY" != true ]]; then
    return 0
  fi

  if [[ -f "$BOOT_COMMON_INI_PATH" ]] && ! is_generated_boot_common_overlay "$BOOT_COMMON_INI_PATH"; then
    existing_crypto_pack="$(read_ini_value "$BOOT_COMMON_INI_PATH" "cryptoPack" || true)"
    if [[ "$existing_crypto_pack" == "$BOOT_CRYPTO_PACK" ]]; then
      echo "[eve.js] Boot overlay: existing common.ini already sets cryptoPack=$BOOT_CRYPTO_PACK"
      return 0
    fi

    if [[ "$FORCE" != true ]]; then
      echo "[eve.js] Refusing to overwrite existing common.ini:" >&2
      echo "  $BOOT_COMMON_INI_PATH" >&2
      echo "[eve.js] Re-run with --force if this staged runtime is disposable." >&2
      return 1
    fi
  fi

  if [[ "$DRY_RUN" == true ]]; then
    echo "[eve.js] Boot overlay: would write common.ini cryptoPack=$BOOT_CRYPTO_PACK"
    echo "  $BOOT_COMMON_INI_PATH"
    return 0
  fi

  temp_path="${BOOT_COMMON_INI_PATH}.tmp"
  if ! {
    printf '; Generated by eve.js launch-offline-client.sh\n'
    printf '; eveprefs merges common.ini after start.ini, so this avoids editing manifest-tracked start.ini.\n'
    printf '[main]\n'
    printf 'cryptoPack = %s\n' "$BOOT_CRYPTO_PACK"
  } >"$temp_path"; then
    echo "[eve.js] Failed to write boot overlay:" >&2
    echo "  $temp_path" >&2
    echo "[eve.js] Re-stage the runtime if macOS is denying writes inside EVE.app." >&2
    rm -f "$temp_path" >/dev/null 2>&1 || true
    return 1
  fi

  if ! mv "$temp_path" "$BOOT_COMMON_INI_PATH"; then
    echo "[eve.js] Failed to install boot overlay:" >&2
    echo "  $BOOT_COMMON_INI_PATH" >&2
    rm -f "$temp_path" >/dev/null 2>&1 || true
    return 1
  fi

  echo "[eve.js] Boot overlay:"
  echo "  common.ini cryptoPack=$BOOT_CRYPTO_PACK"
  echo "  $BOOT_COMMON_INI_PATH"
}

prepare_log_paths() {
  mkdir -p "$(dirname "$CLIENT_STDOUT_PATH")" "$(dirname "$CLIENT_STDERR_PATH")"
}

add_env_var() {
  ENV_VARS+=("$1")
}

sanitize_launch_arg() {
  local value="$1"

  case "$value" in
    /ssoToken=*)
      printf '/ssoToken=***'
      ;;
    /refreshToken=*)
      printf '/refreshToken=***'
      ;;
    /LauncherData=*)
      printf '/LauncherData=***'
      ;;
    /deviceID=*)
      printf '/deviceID=***'
      ;;
    /machineHash=*)
      printf '/machineHash=***'
      ;;
    /journeyID=*)
      printf '/journeyID=***'
      ;;
    *)
      printf '%s' "$value"
      ;;
  esac
}

load_session_args() {
  local path="$1"
  local line=""

  if [[ ! -f "$path" ]]; then
    echo "[eve.js] Launcher session file not found: $path" >&2
    echo "[eve.js] Capture one first with:" >&2
    echo "  bash \"$REPO_ROOT/tools/macos/capture-launcher-session.sh\"" >&2
    exit 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(trim_leading_whitespace "$line")"
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    LAUNCH_ARGS+=("$line")
  done < "$path"
}

# --------------------------------------------------------------------------- #
# Stage metadata verification.
# --------------------------------------------------------------------------- #
read_stage_metadata() {
  local metadata_path="$1"
  local python_output=""

  if [[ ! -f "$metadata_path" ]]; then
    return 1
  fi

  python_output="$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(d.get('build', ''))
print(d.get('patchState', ''))
print('1' if d.get('signed', False) else '0')
print(d.get('signTime', '') or '')
print(d.get('signMode', '') or '')
print(d.get('signIdentity', '') or '')
print(d.get('exefileEntitlementsMode', '') or '')
print('1' if d.get('bootCommonOverlay', False) else '0')
print(d.get('bootCryptoPack', '') or '')
print(d.get('appBundleSignatureMode', '') or '')
print(d.get('resfilesMode', ''))
print(d.get('entrypoint', ''))
print(d.get('sourceRoot', ''))
" "$metadata_path" 2>/dev/null)" || return 1

  STAGE_META_BUILD="$(echo "$python_output" | sed -n '1p')"
  STAGE_META_PATCH_STATE="$(echo "$python_output" | sed -n '2p')"
  STAGE_META_SIGNED="$(echo "$python_output" | sed -n '3p')"
  STAGE_META_SIGN_TIME="$(echo "$python_output" | sed -n '4p')"
  STAGE_META_SIGN_MODE="$(echo "$python_output" | sed -n '5p')"
  STAGE_META_SIGN_IDENTITY="$(echo "$python_output" | sed -n '6p')"
  STAGE_META_EXEFILE_ENTITLEMENTS_MODE="$(echo "$python_output" | sed -n '7p')"
  STAGE_META_BOOT_COMMON_OVERLAY="$(echo "$python_output" | sed -n '8p')"
  STAGE_META_BOOT_CRYPTO_PACK="$(echo "$python_output" | sed -n '9p')"
  STAGE_META_APP_BUNDLE_SIGNATURE_MODE="$(echo "$python_output" | sed -n '10p')"
  STAGE_META_RESFILES_MODE="$(echo "$python_output" | sed -n '11p')"
  STAGE_META_ENTRYPOINT="$(echo "$python_output" | sed -n '12p')"
  STAGE_META_SOURCE_ROOT="$(echo "$python_output" | sed -n '13p')"
  if [[ -z "$STAGE_META_SIGNED" && -n "$STAGE_META_SIGN_TIME" ]]; then
    STAGE_META_SIGNED="1"
  fi

  return 0
}

verify_stage_metadata() {
  local metadata_path="${STAGED_ROOT}/.evejs-stage-metadata.json"

  if [[ "$FORCE" == true ]]; then
    echo "[eve.js] Stage metadata verification skipped (--force)."
    if [[ -f "$metadata_path" ]]; then
      read_stage_metadata "$metadata_path" || true
    fi
    return
  fi

  if ! read_stage_metadata "$metadata_path"; then
    echo "[eve.js] Stage metadata not found: $metadata_path" >&2
    echo "[eve.js] This does not appear to be a valid staged runtime." >&2
    echo "[eve.js] Stage one first:" >&2
    echo "  bash \"$STAGE_HELPER\"" >&2
    echo "[eve.js] Or use --force to skip this check." >&2
    exit 1
  fi

  # If ResFiles are symlinked, verify the source root is available.
  if [[ "$STAGE_META_RESFILES_MODE" == "symlink" && -n "$STAGE_META_SOURCE_ROOT" ]]; then
    local resfiles_link="${STAGED_ROOT}/SharedCache/ResFiles"
    if [[ -L "$resfiles_link" && ! -d "$resfiles_link" ]]; then
      echo "[eve.js] ResFiles symlink target is not accessible." >&2
      echo "[eve.js] Source root was: $STAGE_META_SOURCE_ROOT" >&2
      echo "[eve.js] Restore the source copy, rebuild with --copy-resfiles, or use --force to skip this check." >&2
      exit 1
    fi
  fi
}

print_stage_summary() {
  echo "[eve.js] Stage metadata:"
  if [[ -n "$STAGE_META_BUILD" ]]; then
    echo "  Build:        $STAGE_META_BUILD"
  fi
  if [[ -n "$STAGE_META_PATCH_STATE" ]]; then
    echo "  Patch state:  $STAGE_META_PATCH_STATE"
  fi
  if [[ "$STAGE_META_SIGNED" == "1" ]]; then
    local sign_label="re-signed"
    if [[ "$STAGE_META_SIGN_MODE" == "ad-hoc" ]]; then
      sign_label="ad-hoc re-signed"
    elif [[ "$STAGE_META_SIGN_MODE" == "identity" && -n "$STAGE_META_SIGN_IDENTITY" ]]; then
      sign_label="re-signed with $STAGE_META_SIGN_IDENTITY"
    fi
    if [[ -n "$STAGE_META_SIGN_TIME" ]]; then
      echo "  Signing:      $sign_label ($STAGE_META_SIGN_TIME)"
    else
      echo "  Signing:      $sign_label"
    fi
    if [[ -n "$STAGE_META_EXEFILE_ENTITLEMENTS_MODE" ]]; then
      echo "  Entitlements: exefile $STAGE_META_EXEFILE_ENTITLEMENTS_MODE"
    fi
  else
    echo "  Signing:      original bundle bytes preserved"
  fi
  if [[ "$STAGE_META_BOOT_COMMON_OVERLAY" == "1" ]]; then
    echo "  Boot overlay: common.ini cryptoPack=${STAGE_META_BOOT_CRYPTO_PACK:-Placebo}"
  fi
  if [[ -n "$STAGE_META_APP_BUNDLE_SIGNATURE_MODE" ]]; then
    echo "  App seal:     $STAGE_META_APP_BUNDLE_SIGNATURE_MODE"
  fi
  if [[ -n "$STAGE_META_RESFILES_MODE" ]]; then
    echo "  ResFiles:     $STAGE_META_RESFILES_MODE"
  fi
  if [[ -n "$STAGE_META_ENTRYPOINT" ]]; then
    echo "  Entrypoint:   $STAGE_META_ENTRYPOINT"
  fi
  if [[ -n "$STAGE_META_SOURCE_ROOT" ]]; then
    echo "  Source root:  $STAGE_META_SOURCE_ROOT"
  fi
}

# --------------------------------------------------------------------------- #
# blue.so inspection (read-only).
# --------------------------------------------------------------------------- #
print_blue_so_status() {
  local inspection_output=""
  BLUE_SO_INSPECTION_STATE=""

  if [[ -n "$SESSION_FILE" ]]; then
    return
  fi

  if [[ ! -f "$BLUE_SO_PATCHER" || ! -f "$CLIENT_BLUE_SO" ]]; then
    return
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[eve.js] Warning: python3 is unavailable, so blue.so inspection was skipped."
    return
  fi

  if [[ "$INSPECT_BLUE_SO" == false && "$RUNTIME_PATCH_BLUE_SO" != true ]]; then
    return
  fi

  inspection_output="$(python3 "$BLUE_SO_PATCHER" --input "$CLIENT_BLUE_SO" --inspect)"
  BLUE_SO_INSPECTION_STATE="$(printf '%s\n' "$inspection_output" | sed -n 's/^State:   //p' | head -n 1)"

  if [[ "$INSPECT_BLUE_SO" != false || "$RUNTIME_PATCH_BLUE_SO" == true ]]; then
    echo "[eve.js] blue.so status:"
    printf '%s\n' "$inspection_output" | sed 's/^/  /'
  fi

  if [[ "$BLUE_SO_INSPECTION_STATE" == "patchable_original" || "$BLUE_SO_INSPECTION_STATE" == "supported_source" ]]; then
    echo "[eve.js] Note: blue.so is unmodified in this staged runtime."
    echo "[eve.js] This is the expected macOS path. Start the server in default stock-client mode:"
    echo "  bash \"$REPO_ROOT/QuickstartServer.sh\""
  elif [[ "$BLUE_SO_INSPECTION_STATE" == "already_patched" ]]; then
    echo "[eve.js] Note: blue.so matches the recorded research patch build."
    echo "[eve.js] If you intentionally staged this research path, start the server with:"
    echo "  bash \"$REPO_ROOT/QuickstartServer.sh\" --patched-client"
  elif [[ "$BLUE_SO_INSPECTION_STATE" == "unknown" ]]; then
    echo "[eve.js] Note: this blue.so is not covered by the current research patch manifest."
    echo "[eve.js] That is acceptable for the default unmodified Mac path."
    echo "[eve.js] Do not use --patch-blue-so or --runtime-patch-blue-so until a build-specific manifest is recorded."
  fi
}

# --------------------------------------------------------------------------- #
# Research-only runtime patch helper.
# --------------------------------------------------------------------------- #
run_runtime_blue_so_patch() {
  local client_pid="$1"

  if [[ "$RUNTIME_PATCH_BLUE_SO" != true ]]; then
    return 0
  fi

  if [[ ! -f "$RUNTIME_PATCH_HELPER" ]]; then
    echo "[eve.js] Missing runtime patch helper: $RUNTIME_PATCH_HELPER" >&2
    return 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[eve.js] python3 is required for --runtime-patch-blue-so." >&2
    return 1
  fi

  mkdir -p "$(dirname "$RUNTIME_PATCH_LOG_PATH")"
  echo "[eve.js] Runtime patch: enabled (blue.so in-memory research path)"
  echo "[eve.js] Runtime patch log: $RUNTIME_PATCH_LOG_PATH"
  echo "[eve.js] Match the server mode with:"
  echo "  bash \"$REPO_ROOT/QuickstartServer.sh\" --patched-client"

  if ! python3 "$RUNTIME_PATCH_HELPER" \
    --blue-so "$CLIENT_BLUE_SO" \
    --pid "$client_pid" \
    --output "$RUNTIME_PATCH_LOG_PATH" \
    --wait-seconds "$RUNTIME_PATCH_WAIT_SECONDS"; then
    echo "[eve.js] Runtime blue.so patch failed." >&2
    kill "$client_pid" >/dev/null 2>&1 || true
    wait "$client_pid" >/dev/null 2>&1 || true
    return 1
  fi

  return 0
}

# --------------------------------------------------------------------------- #
# Runtime patch preflight.
# --------------------------------------------------------------------------- #
verify_runtime_patch_prereqs() {
  local devtools_status=""
  local host_app_path=""
  local target_codesign=""
  local target_entitlements=""
  local attach_test_bin=""

  if [[ "$RUNTIME_PATCH_BLUE_SO" != true ]]; then
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[eve.js] python3 is required for --runtime-patch-blue-so." >&2
    return 1
  fi

  if ! python3 - <<'PY' >/dev/null 2>&1
import frida
PY
  then
    echo "[eve.js] Frida is required for --runtime-patch-blue-so." >&2
    echo "[eve.js] Install it with:" >&2
    echo "  python3 -m pip install --user frida-tools frida" >&2
    return 1
  fi

  if command -v codesign >/dev/null 2>&1; then
    target_codesign="$(codesign -dv --verbose=4 "$CLIENT_EXEFILE" 2>&1 || true)"
    target_entitlements="$(codesign -d --entitlements :- "$CLIENT_EXEFILE" 2>&1 || true)"

    if printf '%s\n' "$target_codesign" | grep -q 'flags=.*(runtime)'; then
      if ! printf '%s\n' "$target_entitlements" | grep -q 'com.apple.security.get-task-allow'; then
        echo "[eve.js] Runtime patch attach is blocked by the stock client binary." >&2
        echo "[eve.js] exefile is signed with the hardened runtime and does not expose" >&2
        echo "[eve.js] the get-task-allow entitlement required for debugger attach." >&2
        echo "[eve.js] On this retail Mac build, macOS is expected to deny Frida attach." >&2
        echo "[eve.js] Keep using the untouched staged-client path and continue the" >&2
        echo "[eve.js] Mac port on the server-side auth/crypto track instead." >&2
        return 1
      fi
    fi
  fi

  if command -v DevToolsSecurity >/dev/null 2>&1; then
    devtools_status="$(DevToolsSecurity -status 2>&1 || true)"
    if printf '%s\n' "$devtools_status" | grep -qi "disabled"; then
      echo "[eve.js] macOS developer debugging access is disabled." >&2
      echo "[eve.js] Frida cannot attach to local processes until you enable it:" >&2
      echo "  sudo /usr/sbin/DevToolsSecurity -enable" >&2
      echo "[eve.js] Then re-run Play.sh. If macOS prompts for Developer Tools access," >&2
      echo "[eve.js] allow your terminal app in System Settings > Privacy & Security > Developer Tools." >&2
      return 1
    fi
  fi

  if command -v python3 >/dev/null 2>&1; then
    host_app_path="$(python3 - <<'PY'
import os
import subprocess

pid = os.getpid()
best = ""

for _ in range(12):
    try:
        out = subprocess.check_output(
            ["ps", "-o", "pid=,ppid=,comm=", "-p", str(pid)],
            text=True,
        ).strip()
    except subprocess.CalledProcessError:
        break

    parts = out.split(None, 2)
    if len(parts) < 3:
        break

    command = parts[2].strip()
    if (
        ".app/" in command
        and "Python.app/Contents/MacOS/Python" not in command
    ):
        best = command
        break
    if command and not command.startswith("-"):
        best = command

    ppid = int(parts[1])
    if ppid <= 1 or ppid == pid:
        break
    pid = ppid

print(best)
PY
)"
  fi

  if command -v cc >/dev/null 2>&1; then
    attach_test_bin="$(mktemp /tmp/evejs-frida-attach.XXXXXX)"
    rm -f "$attach_test_bin"
    if ! cc -x c -O0 -o "$attach_test_bin" - >/dev/null 2>&1 <<'C'
#include <unistd.h>
int main(void) { sleep(3); return 0; }
C
    then
      rm -f "$attach_test_bin"
      attach_test_bin=""
    fi
  fi

  if [[ -n "$attach_test_bin" ]] && ! python3 - <<'PY' "$attach_test_bin" >/dev/null 2>&1
import frida
import os
import subprocess
import sys

target = sys.argv[1]
proc = subprocess.Popen([target])
try:
    device = frida.get_local_device()
    session = device.attach(proc.pid)
    session.detach()
finally:
    proc.terminate()
    proc.wait()
    try:
        os.remove(target)
    except OSError:
        pass
PY
  then
    echo "[eve.js] Frida still cannot attach to local processes from this app session." >&2
    if [[ -n "$host_app_path" ]]; then
      echo "[eve.js] Current host app: $host_app_path" >&2
    fi
    echo "[eve.js] In macOS System Settings > Privacy & Security > Developer Tools," >&2
    echo "[eve.js] enable the app hosting this shell, then fully quit and reopen it." >&2
    echo "[eve.js] If you are running inside an automation host, enable that app in System Settings." >&2
    echo "[eve.js] If you are using Terminal or iTerm instead, enable that app instead." >&2
    return 1
  fi

  if [[ -n "$attach_test_bin" ]]; then
    rm -f "$attach_test_bin"
  fi

  return 0
}

# --------------------------------------------------------------------------- #
# Code signature verification.
# --------------------------------------------------------------------------- #
verify_codesign_status() {
  local verify_output=""

  if [[ -n "$SESSION_FILE" ]]; then
    return 0
  fi

  if ! command -v codesign >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$STAGE_META_APP_BUNDLE_SIGNATURE_MODE" == "outer-removed" ]]; then
    echo "[eve.js] macOS code signature: outer app seal intentionally removed"
    echo "[eve.js] Nested CCP-signed exefile/libraries are preserved for direct launch."
    return 0
  fi

  if verify_output="$(codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE" 2>&1)"; then
    echo "[eve.js] macOS code signature: valid"
    return 0
  fi

  echo "[eve.js] macOS code signature: invalid"
  printf '%s\n' "$verify_output" | sed 's/^/  /'
  if [[ "$CLIENT_ROOT_EXPLICIT" == true ]]; then
    echo "[eve.js] Re-sign the app bundle:"
    echo "  bash \"$RESIGN_HELPER\" --client-root \"$CLIENT_ROOT\""
  else
    echo "[eve.js] Re-stage the runtime:"
    echo "  bash \"$STAGE_HELPER\" --clean-stage"
  fi
  return 1
}

# --------------------------------------------------------------------------- #
# Argument parsing.
# --------------------------------------------------------------------------- #
while [[ $# -gt 0 ]]; do
  case "$1" in
    --staged-root)
      STAGED_ROOT="$2"
      STAGED_ROOT_EXPLICIT=true
      shift 2
      ;;
    --client-root)
      CLIENT_ROOT="$2"
      CLIENT_ROOT_EXPLICIT=true
      shift 2
      ;;
    --server-host)
      SERVER_HOST="$2"
      shift 2
      ;;
    --proxy-url)
      PROXY_URL="$2"
      shift 2
      ;;
    --settings-profile)
      SETTINGS_PROFILE="$2"
      shift 2
      ;;
    --language)
      LANGUAGE="$2"
      shift 2
      ;;
    --session-file)
      SESSION_FILE="$2"
      shift 2
      ;;
    --use-captured-session)
      SESSION_FILE="$DEFAULT_SESSION_FILE"
      shift
      ;;
    --direct-exefile)
      LAUNCH_ENTRYPOINT_MODE="exefile"
      ENTRYPOINT_EXPLICIT=true
      shift
      ;;
    --app-wrapper)
      LAUNCH_ENTRYPOINT_MODE="wrapper"
      ENTRYPOINT_EXPLICIT=true
      shift
      ;;
    --grpc-debug)
      GRPC_DEBUG=true
      shift
      ;;
    --client-stdout)
      CLIENT_STDOUT_PATH="$2"
      shift 2
      ;;
    --client-stderr)
      CLIENT_STDERR_PATH="$2"
      shift 2
      ;;
    --grpc-trace)
      GRPC_TRACE_VALUE="$2"
      shift 2
      ;;
    --runtime-patch-blue-so)
      RUNTIME_PATCH_BLUE_SO=true
      shift
      ;;
    --runtime-patch-log)
      RUNTIME_PATCH_LOG_PATH="$2"
      shift 2
      ;;
    --skip-blue-so-inspect)
      INSPECT_BLUE_SO=false
      shift
      ;;
    --boot-common-overlay)
      BOOT_COMMON_OVERLAY=true
      BOOT_COMMON_OVERLAY_EXPLICIT=true
      shift
      ;;
    --no-boot-common-overlay)
      BOOT_COMMON_OVERLAY=false
      BOOT_COMMON_OVERLAY_EXPLICIT=true
      shift
      ;;
    --boot-crypto-pack)
      BOOT_CRYPTO_PACK="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
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

# --------------------------------------------------------------------------- #
# Resolve paths: staged root (preferred) or legacy client root.
# --------------------------------------------------------------------------- #
if [[ "$CLIENT_ROOT_EXPLICIT" == true ]]; then
  echo "[eve.js] Warning: --client-root is a legacy/debug path." >&2
  echo "[eve.js] The recommended workflow is: stage-offline-client.sh + launch with --staged-root." >&2
  echo >&2

  APP_BUNDLE="${CLIENT_ROOT}/SharedCache/tq/EVE.app"
  APP_WRAPPER_BINARY="${APP_BUNDLE}/Contents/MacOS/EVE"
  CLIENT_EXEFILE="${APP_BUNDLE}/Contents/Resources/build/bin64/exefile"
  CLIENT_EXEFILE_DIR="$(dirname "$CLIENT_EXEFILE")"
  CLIENT_BUILD_DIR="${APP_BUNDLE}/Contents/Resources/build"
  CLIENT_BLUE_SO="${APP_BUNDLE}/Contents/Resources/build/bin64/blue.so"

  # In legacy mode with session file, use bundle entrypoint
  if [[ -n "$SESSION_FILE" ]]; then
    LAUNCH_ENTRYPOINT_MODE="wrapper"
  fi
else
  # Resolve staged root
  if [[ -z "$STAGED_ROOT" ]]; then
    STAGED_ROOT="${DEFAULT_STAGED_BASE}/current"
  fi

  # Resolve the current symlink if it exists
  if [[ -L "$STAGED_ROOT" ]]; then
    STAGED_ROOT="$(cd "$STAGED_ROOT" && pwd -P)"
  fi

  if [[ ! -d "$STAGED_ROOT" ]]; then
    echo "[eve.js] Staged runtime not found: $STAGED_ROOT" >&2
    echo "[eve.js] Stage one first:" >&2
    echo "  bash \"$STAGE_HELPER\"" >&2
    exit 1
  fi

  # Verify stage metadata
  verify_stage_metadata

  if [[ "$ENTRYPOINT_EXPLICIT" == false && -n "$STAGE_META_ENTRYPOINT" ]]; then
    LAUNCH_ENTRYPOINT_MODE="$STAGE_META_ENTRYPOINT"
  fi

  if [[ "$BOOT_COMMON_OVERLAY_EXPLICIT" == false && "$STAGE_META_BOOT_COMMON_OVERLAY" == "1" ]]; then
    BOOT_COMMON_OVERLAY=true
    if [[ -n "$STAGE_META_BOOT_CRYPTO_PACK" ]]; then
      BOOT_CRYPTO_PACK="$STAGE_META_BOOT_CRYPTO_PACK"
    fi
  fi

  APP_BUNDLE="${STAGED_ROOT}/SharedCache/tq/EVE.app"
  APP_WRAPPER_BINARY="${APP_BUNDLE}/Contents/MacOS/EVE"
  CLIENT_EXEFILE="${APP_BUNDLE}/Contents/Resources/build/bin64/exefile"
  CLIENT_EXEFILE_DIR="$(dirname "$CLIENT_EXEFILE")"
  CLIENT_BUILD_DIR="${APP_BUNDLE}/Contents/Resources/build"
  CLIENT_BLUE_SO="${APP_BUNDLE}/Contents/Resources/build/bin64/blue.so"
fi

if [[ ! -d "$APP_BUNDLE" ]]; then
  echo "[eve.js] App bundle not found: $APP_BUNDLE" >&2
  exit 1
fi

if [[ ! -x "$APP_WRAPPER_BINARY" ]]; then
  echo "[eve.js] App wrapper binary not found: $APP_WRAPPER_BINARY" >&2
  exit 1
fi

if [[ ! -x "$CLIENT_EXEFILE" ]]; then
  echo "[eve.js] exefile not found: $CLIENT_EXEFILE" >&2
  exit 1
fi

if [[ ! -f "$CA_CERT_PATH" ]]; then
  echo "[eve.js] Missing eve.js CA cert: $CA_CERT_PATH" >&2
  exit 1
fi

# Remove stale generated common.ini only when this launch is not intentionally
# using the staged boot overlay.
if [[ "$BOOT_COMMON_OVERLAY" != true ]]; then
  if ! remove_generated_boot_common_overlay; then
    exit 1
  fi
fi

START_INI_CRYPTO_PACK="$(read_ini_value "${CLIENT_BUILD_DIR}/start.ini" "cryptoPack" || true)"

if [[ "$RUNTIME_PATCH_BLUE_SO" == true ]]; then
  if [[ "$LAUNCH_ENTRYPOINT_MODE" != "exefile" ]]; then
    echo "[eve.js] --runtime-patch-blue-so requires direct exefile launch." >&2
    echo "[eve.js] Remove --app-wrapper and try again." >&2
    exit 1
  fi

  if [[ -n "$SESSION_FILE" ]]; then
    echo "[eve.js] --runtime-patch-blue-so is only supported for copied-client direct login." >&2
    echo "[eve.js] Do not combine it with launcher-session replay." >&2
    exit 1
  fi

  if [[ ! -f "$CLIENT_BLUE_SO" ]]; then
    echo "[eve.js] blue.so not found for runtime patching: $CLIENT_BLUE_SO" >&2
    exit 1
  fi
fi

# --------------------------------------------------------------------------- #
# Pre-launch diagnostics.
# --------------------------------------------------------------------------- #

# Check for eve.js CA in keychain
if command -v security >/dev/null 2>&1; then
  if ! security find-certificate -a -c "eve.js localhost CA" \
    "${HOME}/Library/Keychains/login.keychain-db" >/dev/null 2>&1; then
    echo "[eve.js] Warning: eve.js CA is not trusted in the login keychain."
    echo "[eve.js] The stock macOS client may reject local gateway TLS until you run:"
    echo "  bash \"$REPO_ROOT/tools/macos/install-local-ca.sh\""
  fi
fi

echo "[eve.js] Launching EVE client:"
echo "  $APP_BUNDLE"

if [[ "$CLIENT_ROOT_EXPLICIT" != true && -n "$STAGE_META_BUILD" ]]; then
  print_stage_summary
fi

if [[ "$CLIENT_ROOT_EXPLICIT" != true && "$STAGE_META_PATCH_STATE" == "candidate-patched" && "$STAGE_META_SIGNED" != "1" ]]; then
  echo "[eve.js] Warning: this staged runtime is patched but not re-signed."
  echo "[eve.js] If launch fails at the macOS loader boundary, re-stage with:"
  echo "  bash \"$STAGE_HELPER\" --clean-stage --patch-blue-so --sign"
fi

echo "[eve.js] Proxy: $PROXY_URL"
build_external_ca_bundle
echo "[eve.js] CA bundle: $CA_BUNDLE_PATH"
echo "[eve.js] eve.js CA: $CA_CERT_PATH"
echo "[eve.js] Server: $SERVER_HOST"
echo "[eve.js] Settings profile: $SETTINGS_PROFILE"
if [[ -n "$START_INI_CRYPTO_PACK" ]]; then
  echo "[eve.js] Boot cryptoPack: $START_INI_CRYPTO_PACK (from start.ini)"
else
  echo "[eve.js] Boot cryptoPack: unknown (start.ini has no cryptoPack)"
fi
if [[ "$BOOT_COMMON_OVERLAY" == true ]]; then
  echo "[eve.js] Boot overlay: enabled (common.ini cryptoPack=$BOOT_CRYPTO_PACK)"
else
  echo "[eve.js] Boot overlay: disabled"
  if [[ -n "$START_INI_CRYPTO_PACK" && "$START_INI_CRYPTO_PACK" != "$BOOT_CRYPTO_PACK" ]]; then
    echo "[eve.js] Note: /cryptoPack=$BOOT_CRYPTO_PACK is only a launch arg; stock boot still follows start.ini unless --boot-common-overlay is used."
  fi
fi

if [[ "$LAUNCH_ENTRYPOINT_MODE" == "exefile" ]]; then
  echo "[eve.js] Entrypoint: $CLIENT_EXEFILE (direct exefile)"
  echo "[eve.js] Working dir: $CLIENT_EXEFILE_DIR"
else
  echo "[eve.js] Entrypoint: $APP_WRAPPER_BINARY (wrapper fallback)"
  echo "[eve.js] Working dir: $CLIENT_BUILD_DIR"
fi

if [[ -n "$SESSION_FILE" ]]; then
  load_session_args "$SESSION_FILE"
  echo "[eve.js] Session args: $SESSION_FILE"
  echo "[eve.js] Client flow: stock-client launcher/session replay"
else
  echo "[eve.js] Client flow: copied-client direct login"
fi

print_blue_so_status

if [[ "$RUNTIME_PATCH_BLUE_SO" == true && "$BLUE_SO_INSPECTION_STATE" == "already_patched" ]]; then
  echo "[eve.js] --runtime-patch-blue-so expects an unmodified staged blue.so." >&2
  echo "[eve.js] This staged runtime is already patched/re-signed. Clean-stage first:" >&2
  echo "  bash \"$STAGE_HELPER\" --clean-stage" >&2
  exit 1
fi

if ! verify_runtime_patch_prereqs; then
  exit 1
fi

if [[ -z "$SESSION_FILE" ]] && ! verify_codesign_status; then
  exit 1
fi

if ! write_boot_common_overlay; then
  exit 1
fi

# --------------------------------------------------------------------------- #
# Build launch arguments and environment.
# --------------------------------------------------------------------------- #
upsert_arg "/noconsole" "/noconsole"
upsert_arg "/server:" "/server:${SERVER_HOST}"
upsert_arg "/settingsprofile=" "/settingsprofile=${SETTINGS_PROFILE}"
upsert_arg "/language=" "/language=${LANGUAGE}"
upsert_arg "/cryptoPack=" "/cryptoPack=${BOOT_CRYPTO_PACK}"

add_env_var "SSL_CERT_FILE=$CA_BUNDLE_PATH"
add_env_var "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH=$CA_BUNDLE_PATH"
add_env_var "grpc_default_ssl_roots_file_path=$CA_BUNDLE_PATH"
add_env_var "GRPC_NOT_USE_SYSTEM_SSL_ROOTS=0"
add_env_var "grpc_not_use_system_ssl_roots=0"
add_env_var "REQUESTS_CA_BUNDLE=$CA_BUNDLE_PATH"
add_env_var "CURL_CA_BUNDLE=$CA_BUNDLE_PATH"
add_env_var "http_proxy=$PROXY_URL"
add_env_var "https_proxy=$PROXY_URL"
add_env_var "HTTP_PROXY=$PROXY_URL"
add_env_var "HTTPS_PROXY=$PROXY_URL"
add_env_var "no_proxy=127.0.0.1,localhost,::1"
add_env_var "NO_PROXY=127.0.0.1,localhost,::1"

if [[ "$GRPC_DEBUG" == true ]]; then
  prepare_log_paths
  : >"$CLIENT_STDOUT_PATH"
  : >"$CLIENT_STDERR_PATH"
  add_env_var "GRPC_VERBOSITY=DEBUG"
  add_env_var "grpc_verbosity=DEBUG"
  add_env_var "GRPC_TRACE=$GRPC_TRACE_VALUE"
  add_env_var "grpc_trace=$GRPC_TRACE_VALUE"
  add_env_var "GRPC_STACKTRACE_MINLOGLEVEL=0"
  add_env_var "grpc_stacktrace_minloglevel=0"
  echo "[eve.js] Client stdout: $CLIENT_STDOUT_PATH"
  echo "[eve.js] Client stderr: $CLIENT_STDERR_PATH"
  echo "[eve.js] gRPC trace: $GRPC_TRACE_VALUE"
fi

# --------------------------------------------------------------------------- #
# Dry run.
# --------------------------------------------------------------------------- #
if [[ "$DRY_RUN" == true ]]; then
  local_sanitized_arg=""
  echo "[eve.js] Dry run only. Final launch command:"
  if [[ "$LAUNCH_ENTRYPOINT_MODE" == "exefile" ]]; then
    printf '  cd %q &&' "$CLIENT_EXEFILE_DIR"
    printf ' %q' env
    for env_var in "${ENV_VARS[@]}"; do
      printf ' %q' "$env_var"
    done
    printf ' %q' "$CLIENT_EXEFILE"
  else
    printf '  cd %q &&' "$CLIENT_BUILD_DIR"
    printf ' %q' env
    for env_var in "${ENV_VARS[@]}"; do
      printf ' %q' "$env_var"
    done
    printf ' %q' "$APP_WRAPPER_BINARY"
  fi
  for raw_arg in "${LAUNCH_ARGS[@]}"; do
    local_sanitized_arg="$(sanitize_launch_arg "$raw_arg")"
    printf ' %q' "$local_sanitized_arg"
  done
  printf '\n'
  if [[ "$RUNTIME_PATCH_BLUE_SO" == true ]]; then
    echo "[eve.js] Runtime patch helper will attach after launch:"
    printf '  %q %q --blue-so %q --pid <client-pid> --output %q --wait-seconds %q\n' \
      python3 "$RUNTIME_PATCH_HELPER" "$CLIENT_BLUE_SO" "$RUNTIME_PATCH_LOG_PATH" "$RUNTIME_PATCH_WAIT_SECONDS"
  fi
  exit 0
fi

# --------------------------------------------------------------------------- #
# Launch.
# --------------------------------------------------------------------------- #
prepare_log_paths

if [[ "$LAUNCH_ENTRYPOINT_MODE" == "exefile" ]]; then
  if [[ "$RUNTIME_PATCH_BLUE_SO" == true ]]; then
    if [[ "$GRPC_DEBUG" == true ]]; then
      (
        cd "$CLIENT_EXEFILE_DIR"
        nohup env "${ENV_VARS[@]}" "$CLIENT_EXEFILE" "${LAUNCH_ARGS[@]}" \
          </dev/null \
          >>"$CLIENT_STDOUT_PATH" \
          2>>"$CLIENT_STDERR_PATH" &
        client_pid="$!"
        run_runtime_blue_so_patch "$client_pid"
      )
      exit $?
    fi

    cd "$CLIENT_EXEFILE_DIR"
    env "${ENV_VARS[@]}" "$CLIENT_EXEFILE" "${LAUNCH_ARGS[@]}" &
    client_pid="$!"
    run_runtime_blue_so_patch "$client_pid" || exit 1
    wait "$client_pid"
    exit $?
  fi

  if [[ "$GRPC_DEBUG" == true ]]; then
    (
      cd "$CLIENT_EXEFILE_DIR"
      nohup env "${ENV_VARS[@]}" "$CLIENT_EXEFILE" "${LAUNCH_ARGS[@]}" \
        </dev/null \
        >>"$CLIENT_STDOUT_PATH" \
        2>>"$CLIENT_STDERR_PATH" &
    )
    exit 0
  fi

  cd "$CLIENT_EXEFILE_DIR"
  exec env "${ENV_VARS[@]}" "$CLIENT_EXEFILE" "${LAUNCH_ARGS[@]}"
fi

# Default: direct wrapper execution
if [[ "$GRPC_DEBUG" == true ]]; then
  (
    cd "$CLIENT_BUILD_DIR"
    nohup env "${ENV_VARS[@]}" "$APP_WRAPPER_BINARY" "${LAUNCH_ARGS[@]}" \
      </dev/null \
      >>"$CLIENT_STDOUT_PATH" \
      2>>"$CLIENT_STDERR_PATH" &
  )
  exit 0
fi

cd "$CLIENT_BUILD_DIR"
exec env "${ENV_VARS[@]}" "$APP_WRAPPER_BINARY" "${LAUNCH_ARGS[@]}"
