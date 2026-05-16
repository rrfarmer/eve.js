#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_RETAIL_ROOT="${HOME}/Library/Application Support/EVE Online"
SOURCE_ROOT="${DEFAULT_RETAIL_ROOT}"
SOURCE_SHARED_CACHE=""
DEFAULT_DEST_ROOT="${HOME}/Library/Application Support/eve.js/macos/source-client"
DEST_ROOT="${DEFAULT_DEST_ROOT}"
DEST_SHARED_CACHE=""
START_INI_RELATIVE_PATH="tq/EVE.app/Contents/Resources/build/start.ini"
BLUE_SO_RELATIVE_PATH="tq/EVE.app/Contents/Resources/build/bin64/blue.so"
CACERT_RELATIVE_PATH="tq/EVE.app/Contents/Resources/build/bin64/cacert.pem"
BLUE_SO_PATCHER="${REPO_ROOT}/tools/macos/blue_so_patch.py"
BLUE_SO_PATCH_JSON="${REPO_ROOT}/tools/macos/blue-so.patch.json"
STAGE_HELPER="${REPO_ROOT}/tools/macos/stage-offline-client.sh"
SERVER_HOST="127.0.0.1"
CRYPTO_PACK="Placebo"
PATCH_START_INI=false
INSPECT_BLUE_SO=true
BLUE_SO_STATE=""
skip_copy=false
SKIP_PREFLIGHT=false

usage() {
  cat <<'EOF'
Usage: bash tools/macos/prepare-offline-client.sh [options]

Prepares the canonical local source copy. Does not patch, sign, or produce a
launchable runtime.

The local source copy is the canonical source asset and backup base. To build a
launchable runtime from it, use stage-offline-client.sh after this script.

Defaults:
  source: ~/Library/Application Support/EVE Online/SharedCache
  dest:   ~/Library/Application Support/eve.js/macos/source-client
  start.ini patch: disabled

Options:
  --retail-root <dir>     Retail EVE root containing SharedCache.
                          You may also pass the SharedCache directory itself.
  --dest <dir>            Destination root for the offline copy.
  --no-copy               Validate the existing copy instead of refreshing it.
  --patch-startini        Patch the copied client's start.ini for RESEARCH ONLY.
                          Warning: this taints the source. In-bundle start.ini
                          edits trip the manifest verifier on native macOS.
                          This flag exists for offline inspection, not launch.
  --no-patch-startini     Skip start.ini patching. This is the default.
  --skip-blue-so-inspect  Skip the exact-build blue.so inspection summary.
  --skip-preflight        Skip the source-purity preflight checks.
  --server-host <host>    Server value to write into start.ini. Default: 127.0.0.1
  --crypto-pack <value>   cryptoPack value to write into start.ini. Default: Placebo
  --help                  Show this help text.
EOF
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[eve.js] Missing required command: $name" >&2
    exit 1
  fi
}

resolve_source_shared_cache() {
  if [[ -d "${SOURCE_ROOT}/tq/EVE.app" && "$(basename "$SOURCE_ROOT")" == "SharedCache" ]]; then
    SOURCE_SHARED_CACHE="$SOURCE_ROOT"
    SOURCE_ROOT="$(dirname "$SOURCE_ROOT")"
  else
    SOURCE_SHARED_CACHE="${SOURCE_ROOT}/SharedCache"
  fi
}

copy_client_and_metadata() {
  local dest_parent
  dest_parent="$(dirname "$DEST_SHARED_CACHE")"
  mkdir -p "$dest_parent"

  echo "[eve.js] Copying client bundle and metadata to $DEST_SHARED_CACHE"
  echo "[eve.js] Retail install stays untouched. This local copy is the canonical staged-runtime source."
  rsync -a --delete --exclude 'ResFiles/' "${SOURCE_SHARED_CACHE}/" "${DEST_SHARED_CACHE}/"
}

copy_resfiles() {
  mkdir -p "${DEST_SHARED_CACHE}/ResFiles"

  echo "[eve.js] Copying SharedCache assets to ${DEST_SHARED_CACHE}/ResFiles"
  rsync -a --delete "${SOURCE_SHARED_CACHE}/ResFiles/" "${DEST_SHARED_CACHE}/ResFiles/"
}

trim_leading_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "$value"
}

read_ini_value() {
  local ini_path="$1"
  local expected_key="$2"
  local line=""
  local trimmed=""
  local key=""
  local normalized_key=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="$(trim_leading_whitespace "$line")"
    key="${trimmed%%=*}"
    normalized_key="${key//[[:space:]]/}"
    normalized_key="$(printf '%s' "$normalized_key" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized_key" == "$expected_key" ]]; then
      printf '%s' "${trimmed#*=}" | sed 's/^[[:space:]]*//'
      return 0
    fi
  done < "$ini_path"

  return 1
}

client_backup_path() {
  local relative_path="$1"
  local suffix="$2"
  printf '%s/.evejs-backups/SharedCache/%s%s' "$DEST_ROOT" "$relative_path" "$suffix"
}

patch_start_ini() {
  local ini_path="${DEST_SHARED_CACHE}/${START_INI_RELATIVE_PATH}"
  local backup_path=""
  local temp_path=""
  local line=""
  local trimmed=""
  local key=""
  local normalized_key=""
  local wrote_crypto=false
  local wrote_server=false

  if [[ ! -f "$ini_path" ]]; then
    echo "[eve.js] start.ini not found in copied client: $ini_path" >&2
    exit 1
  fi

  backup_path="$(client_backup_path "$START_INI_RELATIVE_PATH" ".evejs-original")"
  if [[ ! -f "$backup_path" ]]; then
    mkdir -p "$(dirname "$backup_path")"
    cp "$ini_path" "$backup_path"
    echo "[eve.js] Backed up original start.ini outside the app bundle:"
    echo "  $backup_path"
  fi

  temp_path="$(mktemp "${ini_path}.tmp.XXXXXX")"

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="$(trim_leading_whitespace "$line")"
    key="${trimmed%%=*}"
    normalized_key="${key//[[:space:]]/}"
    normalized_key="$(printf '%s' "$normalized_key" | tr '[:upper:]' '[:lower:]')"

    case "$normalized_key" in
      cryptopack)
        if [[ "$wrote_crypto" == false ]]; then
          printf 'cryptoPack = %s\n' "$CRYPTO_PACK" >>"$temp_path"
          wrote_crypto=true
        fi
        ;;
      server|serverip)
        if [[ "$wrote_server" == false ]]; then
          printf 'server = %s\n' "$SERVER_HOST" >>"$temp_path"
          wrote_server=true
        fi
        ;;
      *)
        printf '%s\n' "$line" >>"$temp_path"
        ;;
    esac
  done < "$ini_path"

  if [[ "$wrote_crypto" == false ]]; then
    printf 'cryptoPack = %s\n' "$CRYPTO_PACK" >>"$temp_path"
  fi

  if [[ "$wrote_server" == false ]]; then
    printf 'server = %s\n' "$SERVER_HOST" >>"$temp_path"
  fi

  mv "$temp_path" "$ini_path"
  echo "[eve.js] Patched start.ini in the copied client:"
  echo "  cryptoPack = $CRYPTO_PACK"
  echo "  server = $SERVER_HOST"
}

print_start_ini_status() {
  local ini_path="${DEST_SHARED_CACHE}/${START_INI_RELATIVE_PATH}"
  local build_value=""
  local sync_value=""
  local server_value=""
  local crypto_value=""

  if [[ ! -f "$ini_path" ]]; then
    return
  fi

  build_value="$(read_ini_value "$ini_path" "build" || true)"
  sync_value="$(read_ini_value "$ini_path" "sync" || true)"
  server_value="$(read_ini_value "$ini_path" "server" || true)"
  crypto_value="$(read_ini_value "$ini_path" "cryptopack" || true)"

  echo "[eve.js] start.ini status:"
  if [[ -n "$build_value" ]]; then
    echo "  build = $build_value"
  fi
  if [[ -n "$sync_value" ]]; then
    echo "  sync = $sync_value"
  fi
  if [[ -n "$crypto_value" || -n "$server_value" ]]; then
    echo "  cryptoPack = ${crypto_value:-<unset>}"
    echo "  server = ${server_value:-<unset>}"
  fi
}

warn_if_start_ini_is_still_patched() {
  local ini_path="${DEST_SHARED_CACHE}/${START_INI_RELATIVE_PATH}"
  local backup_path=""
  local server_value=""
  local crypto_value=""

  if [[ "$PATCH_START_INI" == true || ! -f "$ini_path" ]]; then
    return
  fi

  server_value="$(read_ini_value "$ini_path" "server" || true)"
  crypto_value="$(read_ini_value "$ini_path" "cryptopack" || true)"
  backup_path="$(client_backup_path "$START_INI_RELATIVE_PATH" ".evejs-original")"

  if [[ -f "$backup_path" || "$crypto_value" == "Placebo" || "$server_value" == "$SERVER_HOST" ]]; then
    echo "[eve.js] Warning: this copied client still appears to have a patched start.ini inside EVE.app."
    echo "[eve.js] If you hit VerifyManifestFile, restore or refresh the copy first:"
    echo "  bash \"$REPO_ROOT/tools/macos/restore-client-startini.sh\" --client-root \"$DEST_ROOT\""
    echo "  bash \"$REPO_ROOT/tools/macos/prepare-offline-client.sh\" --dest \"$DEST_ROOT\""
  fi
}

inspect_blue_so() {
  local blue_so_path="${DEST_SHARED_CACHE}/${BLUE_SO_RELATIVE_PATH}"
  local inspection_output=""

  if [[ "$INSPECT_BLUE_SO" == false ]]; then
    return
  fi

  if [[ ! -f "$BLUE_SO_PATCHER" ]]; then
    echo "[eve.js] blue.so patch helper not found: $BLUE_SO_PATCHER"
    return
  fi

  echo "[eve.js] blue.so status:"
  inspection_output="$(python3 "$BLUE_SO_PATCHER" --input "$blue_so_path" --inspect)"
  BLUE_SO_STATE="$(printf '%s\n' "$inspection_output" | sed -n 's/^State:   //p' | head -n 1)"
  printf '%s\n' "$inspection_output" | sed 's/^/  /'
}

source_preflight() {
  local ini_path="${DEST_SHARED_CACHE}/${START_INI_RELATIVE_PATH}"
  local blue_so_path="${DEST_SHARED_CACHE}/${BLUE_SO_RELATIVE_PATH}"
  local cacert_path="${DEST_SHARED_CACHE}/${CACERT_RELATIVE_PATH}"
  local server_value=""
  local crypto_value=""
  local tainted=false

  if [[ "$SKIP_PREFLIGHT" == true ]]; then
    return
  fi

  echo "[eve.js] Source preflight: checking for tainted source state..."

  # Check start.ini for patched values
  if [[ -f "$ini_path" ]]; then
    server_value="$(read_ini_value "$ini_path" "server" || true)"
    crypto_value="$(read_ini_value "$ini_path" "cryptopack" || true)"
    if [[ "$crypto_value" == "Placebo" ]]; then
      echo "[eve.js] Warning: source start.ini has cryptoPack=Placebo. This source is tainted." >&2
      tainted=true
    fi
    if [[ "$server_value" == "127.0.0.1" || "$server_value" == "localhost" ]]; then
      echo "[eve.js] Warning: source start.ini has server=$server_value. This source is tainted." >&2
      tainted=true
    fi
  fi

  # Check cacert.pem for eve.js CA injection
  if [[ -f "$cacert_path" ]]; then
    if grep -q "eve.js localhost CA" "$cacert_path" 2>/dev/null; then
      echo "[eve.js] Warning: source cacert.pem contains the eve.js CA. This source is tainted." >&2
      tainted=true
    fi
  fi

  # Check blue.so against known hashes in the research patch manifest. A hash
  # mismatch is normal after a retail client update when we are keeping the
  # staged runtime unmodified; it is only unsafe for exact-build patching.
  if [[ -f "$blue_so_path" && -f "$BLUE_SO_PATCH_JSON" ]] && command -v python3 >/dev/null 2>&1; then
    local actual_hash=""
    actual_hash="$(shasum -a 256 "$blue_so_path" | awk '{print $1}')"
    local source_hash=""
    source_hash="$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(d.get('source', {}).get('sha256', ''))
" "$BLUE_SO_PATCH_JSON" 2>/dev/null || true)"
    local target_hash=""
    target_hash="$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(d.get('target', {}).get('sha256', ''))
" "$BLUE_SO_PATCH_JSON" 2>/dev/null || true)"

    if [[ -n "$actual_hash" && -n "$source_hash" && "$actual_hash" != "$source_hash" ]]; then
      if [[ "$actual_hash" == "$target_hash" ]]; then
        echo "[eve.js] Warning: source blue.so matches the candidate-patched hash, not the original." >&2
        echo "[eve.js] This source has already been patched. Restore it before using it as a clean source." >&2
        tainted=true
      else
        echo "[eve.js] Note: source blue.so is not covered by blue-so.patch.json."
        echo "[eve.js] Manifest source: $source_hash"
        echo "[eve.js] Actual source:   $actual_hash"
        echo "[eve.js] This is acceptable for the default unmodified Mac path."
        echo "[eve.js] Exact-build blue.so patching remains disabled for this build."
      fi
    fi
  fi

  if [[ "$tainted" == true ]]; then
  echo "[eve.js] Source preflight found tainted state in the local source copy."
  echo "[eve.js] The local source copy should stay a clean canonical source asset."
  echo "[eve.js] Refresh it from the retail install or restore the tainted files:"
    echo "  bash \"$REPO_ROOT/tools/macos/restore-client-startini.sh\" --client-root \"$DEST_ROOT\""
    echo "  bash \"$REPO_ROOT/tools/macos/restore-client-blue-so.sh\" --client-root \"$DEST_ROOT\""
    echo "[eve.js] Or re-run with --skip-preflight to ignore these warnings."
  else
    echo "[eve.js] Source preflight: clean."
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST_ROOT="$2"
      shift 2
      ;;
    --retail-root)
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --no-copy)
      skip_copy=true
      shift
      ;;
    --patch-startini)
      PATCH_START_INI=true
      shift
      ;;
    --no-patch-startini)
      PATCH_START_INI=false
      shift
      ;;
    --skip-blue-so-inspect)
      INSPECT_BLUE_SO=false
      shift
      ;;
    --skip-preflight)
      SKIP_PREFLIGHT=true
      shift
      ;;
    --server-host)
      SERVER_HOST="$2"
      shift 2
      ;;
    --crypto-pack)
      CRYPTO_PACK="$2"
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

DEST_SHARED_CACHE="${DEST_ROOT}/SharedCache"
resolve_source_shared_cache

require_command rsync
require_command python3

if [[ ! -d "$SOURCE_SHARED_CACHE" ]]; then
  echo "[eve.js] Source SharedCache not found: $SOURCE_SHARED_CACHE" >&2
  exit 1
fi

if [[ "$skip_copy" == false ]]; then
  copy_client_and_metadata
  copy_resfiles
fi

if [[ ! -d "${DEST_SHARED_CACHE}/tq/EVE.app" ]]; then
  echo "[eve.js] Offline client app bundle not found: ${DEST_SHARED_CACHE}/tq/EVE.app" >&2
  exit 1
fi

source_preflight

if [[ "$PATCH_START_INI" == true ]]; then
  echo "[eve.js] Warning: --patch-startini taints the source. Use for research only, not launch."
  patch_start_ini
fi

print_start_ini_status
warn_if_start_ini_is_still_patched
inspect_blue_so

echo
echo "[eve.js] Source copy is ready."
echo "[eve.js] Source root: $DEST_ROOT"
echo "[eve.js] This is the canonical source asset for byte-preserving staging. It is not a launchable runtime."
echo
echo "[eve.js] Next step: build a staged runtime from this source:"
if [[ -f "$STAGE_HELPER" ]]; then
  echo "  bash \"$STAGE_HELPER\" --source-root \"$DEST_ROOT\""
else
  echo "  bash \"$REPO_ROOT/tools/macos/stage-offline-client.sh\" --source-root \"$DEST_ROOT\""
fi
echo
echo "[eve.js] Restore helpers if you need to revert the source copy:"
echo "  bash \"$REPO_ROOT/tools/macos/restore-client-startini.sh\" --client-root \"$DEST_ROOT\""
echo "  bash \"$REPO_ROOT/tools/macos/restore-client-blue-so.sh\" --client-root \"$DEST_ROOT\""
echo "[eve.js] Retail install untouched: $SOURCE_ROOT"
