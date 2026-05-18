#!/usr/bin/env bash

set -euo pipefail

DEFAULT_STAGED_BASE="${HOME}/Library/Application Support/eve.js/macos/staged-client"
DEFAULT_CLIENT_ROOT="${HOME}/Library/Application Support/EVE Online"
STAGED_ROOT=""
STAGED_ROOT_EXPLICIT=false
CLIENT_ROOT="${DEFAULT_CLIENT_ROOT}"
CLIENT_ROOT_EXPLICIT=false
TMP_STAGE_ROOT=""
KEEP_STAGE=false
APP_BUNDLE=""
BLUE_SO_PATH=""
CLIENT_EXEFILE_PATH=""
LOCAL_BIN64_DIR=""
LOCAL_STAGE_ROOT=""
LOCAL_APP_BUNDLE=""
LOCAL_BLUE_SO=""
LOCAL_EXEFILE=""
LOCAL_WRAPPER_BINARY=""
LOCAL_EXEFILE_ENTITLEMENTS=""
TARGET_STAGE_APP=""
APP_BACKUP_PATH=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/resign-offline-client.sh [options]

Re-signs a macOS EVE app bundle after an exact-build native patch.

When used with --staged-root (recommended), signs the staged runtime in place.
The staged copy is already on the local system volume so no stage/swap is needed.

When used with --client-root (legacy), stages EVE.app on the local system volume,
signs it, verifies the result, and swaps the signed bundle back.

Options:
  --staged-root <dir>  Staged runtime root to sign in place. Recommended.
  --client-root <dir>  [legacy] Root directory containing a source SharedCache.
  --temp-root <dir>    Local staging directory for legacy mode.
  --keep-stage         Keep the local staging directory after legacy mode.
  --help               Show this help text.
EOF
}

cleanup() {
  if [[ -n "$TARGET_STAGE_APP" && -d "$TARGET_STAGE_APP" ]]; then
    rm -rf "$TARGET_STAGE_APP"
  fi
  if [[ "$KEEP_STAGE" == false && -n "$LOCAL_STAGE_ROOT" && -d "$LOCAL_STAGE_ROOT" ]]; then
    rm -rf "$LOCAL_STAGE_ROOT"
  fi
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[eve.js] Missing required command: $name" >&2
    exit 1
  fi
}

external_backup_path_for() {
  local absolute_path="$1"
  local relative_path=""
  relative_path="${absolute_path#"${CLIENT_ROOT}/"}"
  printf '%s/.evejs-backups/%s' "$CLIENT_ROOT" "$relative_path"
}

relocate_legacy_backup() {
  local source_path="$1"
  local destination_path=""

  if [[ ! -f "$source_path" ]]; then
    return
  fi

  destination_path="$(external_backup_path_for "$source_path")"
  mkdir -p "$(dirname "$destination_path")"

  if [[ -f "$destination_path" ]]; then
    rm -f "$source_path"
    echo "[eve.js] Removed stale in-bundle backup already preserved externally:"
    echo "  $source_path"
    return
  fi

  mv "$source_path" "$destination_path"
  echo "[eve.js] Moved legacy in-bundle backup outside EVE.app:"
  echo "  $source_path"
  echo "  -> $destination_path"
}

prepare_paths() {
  APP_BUNDLE="${CLIENT_ROOT}/SharedCache/tq/EVE.app"
  BLUE_SO_PATH="${APP_BUNDLE}/Contents/Resources/build/bin64/blue.so"
  CLIENT_EXEFILE_PATH="${APP_BUNDLE}/Contents/Resources/build/bin64/exefile"

  if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "[eve.js] Copied app bundle not found: $APP_BUNDLE" >&2
    exit 1
  fi

  if [[ ! -f "$BLUE_SO_PATH" ]]; then
    echo "[eve.js] blue.so not found in copied app bundle: $BLUE_SO_PATH" >&2
    exit 1
  fi

  if [[ ! -x "$CLIENT_EXEFILE_PATH" ]]; then
    echo "[eve.js] exefile not found in copied app bundle: $CLIENT_EXEFILE_PATH" >&2
    echo "[eve.js] Refresh the copied client from retail before re-signing." >&2
    exit 1
  fi
}

stage_locally() {
  if [[ -n "$TMP_STAGE_ROOT" ]]; then
    mkdir -p "$TMP_STAGE_ROOT"
    LOCAL_STAGE_ROOT="$(mktemp -d "${TMP_STAGE_ROOT%/}/evejs-resign.XXXXXX")"
  else
    LOCAL_STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/evejs-resign.XXXXXX")"
  fi

  LOCAL_APP_BUNDLE="${LOCAL_STAGE_ROOT}/EVE.app"
  LOCAL_BLUE_SO="${LOCAL_APP_BUNDLE}/Contents/Resources/build/bin64/blue.so"
  LOCAL_EXEFILE="${LOCAL_APP_BUNDLE}/Contents/Resources/build/bin64/exefile"
  LOCAL_BIN64_DIR="${LOCAL_APP_BUNDLE}/Contents/Resources/build/bin64"
  LOCAL_WRAPPER_BINARY="${LOCAL_APP_BUNDLE}/Contents/MacOS/EVE"
  LOCAL_EXEFILE_ENTITLEMENTS="${LOCAL_STAGE_ROOT}/evejs-exefile-entitlements.plist"

  echo "[eve.js] Staging copied app bundle on the local system volume:"
  echo "  $LOCAL_STAGE_ROOT"
  ditto "$APP_BUNDLE" "$LOCAL_APP_BUNDLE"
}

write_exefile_entitlements() {
  cat > "$LOCAL_EXEFILE_ENTITLEMENTS" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
EOF
}

sign_nested_macho() {
  local path=""
  local file_info=""

  while IFS= read -r -d '' path; do
    file_info="$(file -b "$path" 2>/dev/null || true)"
    if [[ "$file_info" != *"Mach-O"* ]]; then
      continue
    fi

    codesign --force --sign - --timestamp=none \
      --preserve-metadata=identifier,entitlements,flags,runtime \
      "$path"
  done < <(find "$LOCAL_BIN64_DIR" -maxdepth 1 -type f -print0 | sort -z)
}

sign_local_stage() {
  write_exefile_entitlements

  echo "[eve.js] Re-signing Mach-O files in build/bin64..."
  sign_nested_macho

  echo "[eve.js] Re-signing exefile with library-validation disabled..."
  codesign --force --sign - --timestamp=none \
    --options runtime \
    --entitlements "$LOCAL_EXEFILE_ENTITLEMENTS" \
    "$LOCAL_EXEFILE"

  if [[ -x "$LOCAL_WRAPPER_BINARY" ]]; then
    echo "[eve.js] Re-signing the app wrapper binary..."
    codesign --force --sign - --timestamp=none \
      --options runtime \
      "$LOCAL_WRAPPER_BINARY"
  fi

  echo "[eve.js] Re-signing the staged app bundle..."
  codesign --force --deep --sign - --timestamp=none \
    --preserve-metadata=identifier,entitlements,flags,runtime \
    "$LOCAL_APP_BUNDLE"

  echo "[eve.js] Verifying the staged app bundle..."
  codesign --verify --deep --strict --verbose=4 "$LOCAL_APP_BUNDLE" >/dev/null
}

swap_signed_bundle_into_client() {
  local target_parent=""
  local backup_root=""
  local timestamp=""

  target_parent="$(dirname "$APP_BUNDLE")"
  TARGET_STAGE_APP="${target_parent}/EVE.evejs-signed-stage.app"
  rm -rf "$TARGET_STAGE_APP"

  echo "[eve.js] Copying the signed app bundle back to the copied client..."
  ditto "$LOCAL_APP_BUNDLE" "$TARGET_STAGE_APP"

  backup_root="${CLIENT_ROOT}/.evejs-backups/app-bundles"
  mkdir -p "$backup_root"
  timestamp="$(date +%Y%m%d-%H%M%S)"
  APP_BACKUP_PATH="${backup_root}/EVE.app.pre-resign.${timestamp}"

  mv "$APP_BUNDLE" "$APP_BACKUP_PATH"
  mv "$TARGET_STAGE_APP" "$APP_BUNDLE"

  if ! codesign --verify --deep --strict --verbose=4 "$APP_BUNDLE" >/dev/null; then
    echo "[eve.js] Signed app bundle did not verify after swap; rolling back." >&2
    rm -rf "$APP_BUNDLE"
    mv "$APP_BACKUP_PATH" "$APP_BUNDLE"
    exit 1
  fi

  TARGET_STAGE_APP=""
}

update_stage_metadata_sign_time() {
  local metadata_path="${STAGED_ROOT}/.evejs-stage-metadata.json"
  local sign_time=""

  if [[ ! -f "$metadata_path" ]]; then
    return
  fi

  sign_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  python3 -c "
import json, sys
with open(sys.argv[1], 'r') as f:
    d = json.load(f)
d['signTime'] = sys.argv[2]
with open(sys.argv[1], 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\\n')
" "$metadata_path" "$sign_time" 2>/dev/null || true

  echo "[eve.js] Updated stage metadata signTime: $sign_time"
}

sign_staged_runtime_in_place() {
  APP_BUNDLE="${STAGED_ROOT}/SharedCache/tq/EVE.app"
  BLUE_SO_PATH="${APP_BUNDLE}/Contents/Resources/build/bin64/blue.so"
  CLIENT_EXEFILE_PATH="${APP_BUNDLE}/Contents/Resources/build/bin64/exefile"
  LOCAL_BIN64_DIR="${APP_BUNDLE}/Contents/Resources/build/bin64"
  LOCAL_EXEFILE="$CLIENT_EXEFILE_PATH"
  LOCAL_WRAPPER_BINARY="${APP_BUNDLE}/Contents/MacOS/EVE"
  LOCAL_EXEFILE_ENTITLEMENTS="${STAGED_ROOT}/evejs-exefile-entitlements.plist"
  LOCAL_APP_BUNDLE="$APP_BUNDLE"

  if [[ ! -d "$APP_BUNDLE" ]]; then
    echo "[eve.js] Staged app bundle not found: $APP_BUNDLE" >&2
    exit 1
  fi

  sign_local_stage

  echo "[eve.js] Verifying staged app bundle..."
  if ! codesign --verify --deep --strict --verbose=4 "$APP_BUNDLE" >/dev/null 2>&1; then
    echo "[eve.js] Staged app bundle failed codesign verification:" >&2
    codesign --verify --deep --strict --verbose=4 "$APP_BUNDLE" 2>&1 | sed 's/^/  /' >&2
    exit 1
  fi

  rm -f "$LOCAL_EXEFILE_ENTITLEMENTS"
  update_stage_metadata_sign_time

  echo "[eve.js] Re-signed staged app bundle is ready."
  echo "  App: $APP_BUNDLE"
}

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
    --temp-root)
      TMP_STAGE_ROOT="$2"
      shift 2
      ;;
    --keep-stage)
      KEEP_STAGE=true
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

trap cleanup EXIT

require_command codesign

# Staged runtime path: sign in place, no stage/swap needed
if [[ "$STAGED_ROOT_EXPLICIT" == true ]]; then
  # Resolve current symlink if needed
  if [[ -L "$STAGED_ROOT" ]]; then
    STAGED_ROOT="$(cd "$STAGED_ROOT" && pwd -P)"
  fi
  sign_staged_runtime_in_place
  exit 0
fi

# Default: check for staged current symlink
if [[ "$CLIENT_ROOT_EXPLICIT" == false ]]; then
  local_default_staged="${DEFAULT_STAGED_BASE}/current"
  if [[ -L "$local_default_staged" || -d "$local_default_staged" ]]; then
  if [[ -L "$local_default_staged" ]]; then
      STAGED_ROOT="$(cd "$local_default_staged" && pwd -P)"
    else
      STAGED_ROOT="$local_default_staged"
    fi
    sign_staged_runtime_in_place
    exit 0
  fi
fi

# Legacy path: stage/sign/swap for source-copy bundles.
echo "[eve.js] Using legacy client-root path for source-copy bundle."
require_command ditto
prepare_paths

relocate_legacy_backup "${APP_BUNDLE}/Contents/Resources/build/bin64/blue.so.original"
relocate_legacy_backup "${APP_BUNDLE}/Contents/Resources/build/bin64/blue.so.evejs-original"
relocate_legacy_backup "${APP_BUNDLE}/Contents/Resources/build/start.ini.evejs-original"

stage_locally
sign_local_stage
swap_signed_bundle_into_client

echo "[eve.js] Re-signed copied app bundle is ready."
echo "  App:        $APP_BUNDLE"
echo "  Backup app: $APP_BACKUP_PATH"
if [[ "$KEEP_STAGE" == true ]]; then
  echo "  Stage:      $LOCAL_STAGE_ROOT"
fi
