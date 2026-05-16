#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_SOURCE_ROOT="${HOME}/Library/Application Support/eve.js/macos/source-client"
DEFAULT_STAGED_BASE="${HOME}/Library/Application Support/eve.js/macos/staged-client"
SOURCE_ROOT="${DEFAULT_SOURCE_ROOT}"
STAGED_BASE="${DEFAULT_STAGED_BASE}"
BLUE_SO_PATCHER="${REPO_ROOT}/tools/macos/blue_so_patch.py"
BLUE_SO_PATCH_JSON="${REPO_ROOT}/tools/macos/blue-so.patch.json"
LAUNCH_HELPER="${REPO_ROOT}/tools/macos/launch-offline-client.sh"

PATCH_BLUE_SO=false
COPY_RESFILES=false
CLEAN_STAGE=false
SIGN_STAGE=false
SIGN_IDENTITY="-"
EXEFILE_ENTITLEMENTS_MODE="research"
NO_COPY=false
ENTRYPOINT="exefile"
BOOT_COMMON_OVERLAY=false
BOOT_CRYPTO_PACK="Placebo"
REMOVE_APP_BUNDLE_SIGNATURE=false
APP_BUNDLE_SIGNATURE_MODE="preserved"

# Resolved after argument parsing
SOURCE_SHARED_CACHE=""
BUILD_NUMBER=""
STAGED_ROOT=""
STAGED_SHARED_CACHE=""
STAGED_APP_BUNDLE=""
STAGED_BIN64=""
STAGED_BLUE_SO=""
STAGED_EXEFILE=""
STAGED_WRAPPER=""
METADATA_PATH=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/stage-offline-client.sh [options]

Assembles a launchable SharedCache runtime tree on the local system volume from
the local source copy. The staged runtime is the active local launch target. The
source copy is never modified.

Staged layout:
  <staged-root>/
    SharedCache/
      tq/EVE.app/...
      ResFiles -> <source>/SharedCache/ResFiles   (symlink by default)
      index_tranquility.txt
    .evejs-stage-metadata.json

Staged roots are build-specific:
  ~/Library/Application Support/eve.js/macos/staged-client/<build>/
  ~/Library/Application Support/eve.js/macos/staged-client/current -> ./<build>

Options:
  --source-root <dir>     Source-copy root. Default:
                          ~/Library/Application Support/eve.js/macos/source-client
  --staged-root <dir>     Override staged root base directory. Default:
                          ~/Library/Application Support/eve.js/macos/staged-client
  --patch-blue-so         Research only. Apply the exact-build blue.so candidate
                          during staging. The normal macOS path leaves blue.so
                          untouched.
  --copy-resfiles         Full-copy ResFiles instead of symlinking to the source.
  --clean-stage           Destroy the existing build-specific staged directory and
                          rebuild from scratch.
  --sign                  Re-sign the staged app bundle after mutation. Only
                          needed for explicit research flows such as --patch-blue-so.
  --sign-identity <id>    Code-signing identity for --sign. Default: - (ad-hoc).
  --preserve-exefile-entitlements
                          Re-sign exefile with its existing entitlements. Use
                          this for unpatched signing controls.
  --no-sign               Preserve the original on-disk signature bytes. This is
                          the default and the recommended macOS path.
  --boot-common-overlay   Write a generated common.ini boot overlay into the
                          staged app so eveprefs overrides start.ini.
  --boot-crypto-pack <v>  cryptoPack value for --boot-common-overlay. Default:
                          Placebo.
  --remove-app-bundle-signature
                          Remove only EVE.app's outer bundle signature after
                          writing common.ini. Nested CCP-signed Mach-O files are
                          left untouched. This is the current Mac Placebo path.
  --no-copy               Re-sign or re-patch an existing staged copy without
                          copying from the source again.
  --entrypoint <mode>     Record intended entrypoint in metadata: exefile
                          (default) or wrapper.
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

# --------------------------------------------------------------------------- #
# Read the build number from the source copy's start.ini.
# --------------------------------------------------------------------------- #
read_build_number() {
  local ini_path="${SOURCE_SHARED_CACHE}/tq/EVE.app/Contents/Resources/build/start.ini"
  local line=""
  local trimmed=""
  local key=""
  local normalized_key=""

  if [[ ! -f "$ini_path" ]]; then
    echo "[eve.js] start.ini not found in source: $ini_path" >&2
    exit 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    trimmed="${line#"${line%%[![:space:]]*}"}"
    key="${trimmed%%=*}"
    normalized_key="${key//[[:space:]]/}"
    normalized_key="$(printf '%s' "$normalized_key" | tr '[:upper:]' '[:lower:]')"
    if [[ "$normalized_key" == "build" ]]; then
      printf '%s' "${trimmed#*=}" | sed 's/^[[:space:]]*//'
      return 0
    fi
  done < "$ini_path"

  echo "[eve.js] Could not read build number from $ini_path" >&2
  exit 1
}

# --------------------------------------------------------------------------- #
# Verify the source copy exists.
# --------------------------------------------------------------------------- #
source_preflight() {
  local volume_path=""

  # If someone opts into an external source, fail with a useful volume message.
  if [[ "$SOURCE_ROOT" == /Volumes/* ]]; then
    volume_path="/Volumes/$(echo "$SOURCE_ROOT" | cut -d'/' -f3)"
    if [[ ! -d "$volume_path" ]]; then
      echo "[eve.js] Source volume is not mounted: $volume_path" >&2
      echo "[eve.js] Mount the source volume or choose a local --source-root." >&2
      exit 1
    fi
  fi

  if [[ ! -d "$SOURCE_SHARED_CACHE" ]]; then
    echo "[eve.js] Source SharedCache not found: $SOURCE_SHARED_CACHE" >&2
    exit 1
  fi

  if [[ ! -d "${SOURCE_SHARED_CACHE}/tq/EVE.app" ]]; then
    echo "[eve.js] Source app bundle not found: ${SOURCE_SHARED_CACHE}/tq/EVE.app" >&2
    exit 1
  fi
}

# --------------------------------------------------------------------------- #
# Build-drift preflight: verify source blue.so matches blue-so.patch.json.
# --------------------------------------------------------------------------- #
build_drift_preflight() {
  local source_blue_so="${SOURCE_SHARED_CACHE}/tq/EVE.app/Contents/Resources/build/bin64/blue.so"

  if [[ "$PATCH_BLUE_SO" == false ]]; then
    return
  fi

  if [[ ! -f "$BLUE_SO_PATCH_JSON" ]]; then
    echo "[eve.js] blue-so.patch.json not found: $BLUE_SO_PATCH_JSON" >&2
    echo "[eve.js] Cannot verify build compatibility before patching." >&2
    exit 1
  fi

  if [[ ! -f "$source_blue_so" ]]; then
    echo "[eve.js] Source blue.so not found: $source_blue_so" >&2
    exit 1
  fi

  local actual_hash=""
  actual_hash="$(shasum -a 256 "$source_blue_so" | awk '{print $1}')"

  local expected_hash=""
  expected_hash="$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print(d.get('source', {}).get('sha256', ''))
" "$BLUE_SO_PATCH_JSON" 2>/dev/null || true)"

  if [[ -z "$expected_hash" ]]; then
    echo "[eve.js] Could not read source hash from blue-so.patch.json." >&2
    exit 1
  fi

  if [[ "$actual_hash" != "$expected_hash" ]]; then
    echo "[eve.js] Build drift detected: source blue.so does not match blue-so.patch.json." >&2
    echo "[eve.js] Expected: $expected_hash" >&2
    echo "[eve.js] Actual:   $actual_hash" >&2
    echo "[eve.js] Refusing to patch. Update the patch manifest or restore the source." >&2
    exit 1
  fi
}

# --------------------------------------------------------------------------- #
# Prepare the build-specific staged directory.
# --------------------------------------------------------------------------- #
prepare_staged_root() {
  local current_link="${STAGED_BASE}/current"

  STAGED_ROOT="${STAGED_BASE}/${BUILD_NUMBER}"
  STAGED_SHARED_CACHE="${STAGED_ROOT}/SharedCache"
  STAGED_APP_BUNDLE="${STAGED_SHARED_CACHE}/tq/EVE.app"
  STAGED_BIN64="${STAGED_APP_BUNDLE}/Contents/Resources/build/bin64"
  STAGED_BLUE_SO="${STAGED_BIN64}/blue.so"
  STAGED_EXEFILE="${STAGED_BIN64}/exefile"
  STAGED_WRAPPER="${STAGED_APP_BUNDLE}/Contents/MacOS/EVE"
  METADATA_PATH="${STAGED_ROOT}/.evejs-stage-metadata.json"

  if [[ "$CLEAN_STAGE" == true && -d "$STAGED_ROOT" ]]; then
    echo "[eve.js] Cleaning existing staged directory: $STAGED_ROOT"
    rm -rf "$STAGED_ROOT"
  fi

  mkdir -p "$STAGED_ROOT"

  # Create or update the current symlink
  if [[ -L "$current_link" ]]; then
    rm -f "$current_link"
  elif [[ -e "$current_link" ]]; then
    echo "[eve.js] Warning: $current_link exists but is not a symlink. Leaving it alone."
    return
  fi

  ln -s "./${BUILD_NUMBER}" "$current_link"
  echo "[eve.js] Staged root: $STAGED_ROOT"
  echo "[eve.js] Current link: $current_link -> ./${BUILD_NUMBER}"
}

# --------------------------------------------------------------------------- #
# Copy the app bundle and metadata from the source copy.
# --------------------------------------------------------------------------- #
copy_source_to_stage() {
  if [[ "$NO_COPY" == true ]]; then
    if [[ ! -d "$STAGED_APP_BUNDLE" ]]; then
      echo "[eve.js] --no-copy was specified but staged app bundle does not exist: $STAGED_APP_BUNDLE" >&2
      exit 1
    fi
    echo "[eve.js] Skipping copy (--no-copy). Using existing staged app bundle."
    return
  fi

  echo "[eve.js] Copying EVE.app from source to staged root..."
  mkdir -p "${STAGED_SHARED_CACHE}/tq"
  ditto "${SOURCE_SHARED_CACHE}/tq/EVE.app" "$STAGED_APP_BUNDLE"

  # Copy index_tranquility.txt
  local source_index="${SOURCE_SHARED_CACHE}/index_tranquility.txt"
  if [[ -f "$source_index" ]]; then
    cp "$source_index" "${STAGED_SHARED_CACHE}/index_tranquility.txt"
    echo "[eve.js] Copied index_tranquility.txt"
  fi
}

# --------------------------------------------------------------------------- #
# Remove local macOS access-control xattrs from the disposable staged app.
# --------------------------------------------------------------------------- #
strip_staged_local_access_xattrs() {
  if [[ ! -d "$STAGED_APP_BUNDLE" ]]; then
    return
  fi

  # com.apple.macl can make a copied app bundle effectively read-only from the
  # launching process. The staged bundle is disposable, so drop only local
  # access/quarantine metadata while preserving the original signed file bytes.
  xattr -dr com.apple.macl "$STAGED_APP_BUNDLE" >/dev/null 2>&1 || true
  xattr -dr com.apple.quarantine "$STAGED_APP_BUNDLE" >/dev/null 2>&1 || true
}

# --------------------------------------------------------------------------- #
# Set up ResFiles: symlink (default) or full copy.
# --------------------------------------------------------------------------- #
setup_resfiles() {
  local staged_resfiles="${STAGED_SHARED_CACHE}/ResFiles"
  local source_resfiles="${SOURCE_SHARED_CACHE}/ResFiles"

  if [[ "$NO_COPY" == true && -e "$staged_resfiles" ]]; then
    echo "[eve.js] Skipping ResFiles setup (--no-copy). Using existing."
    return
  fi

  # Remove any existing ResFiles (symlink or directory) to set up fresh
  if [[ -L "$staged_resfiles" ]]; then
    rm -f "$staged_resfiles"
  elif [[ -d "$staged_resfiles" ]]; then
    rm -rf "$staged_resfiles"
  fi

  if [[ ! -d "$source_resfiles" ]]; then
    echo "[eve.js] Warning: source ResFiles not found: $source_resfiles"
    echo "[eve.js] Staged runtime will not have ResFiles. Game assets may be missing."
    return
  fi

  if [[ "$COPY_RESFILES" == true ]]; then
    echo "[eve.js] Copying ResFiles from source (this may take a while)..."
    ditto "$source_resfiles" "$staged_resfiles"
    echo "[eve.js] ResFiles: copied"
  else
    ln -s "$source_resfiles" "$staged_resfiles"
    echo "[eve.js] ResFiles: symlinked -> $source_resfiles"
  fi
}

# --------------------------------------------------------------------------- #
# Apply the exact-build blue.so candidate patch.
# --------------------------------------------------------------------------- #
apply_blue_so_patch() {
  if [[ "$PATCH_BLUE_SO" == false ]]; then
    return
  fi

  if [[ ! -f "$BLUE_SO_PATCHER" ]]; then
    echo "[eve.js] blue.so patch helper not found: $BLUE_SO_PATCHER" >&2
    exit 1
  fi

  echo "[eve.js] Applying exact-build blue.so candidate patch to staged runtime..."
  python3 "$BLUE_SO_PATCHER" --input "$STAGED_BLUE_SO" --in-place
  echo "[eve.js] blue.so patch applied."
}

# --------------------------------------------------------------------------- #
# Optional boot overlay for stock Mac Placebo transport.
# --------------------------------------------------------------------------- #
write_boot_common_overlay() {
  local overlay_path="${STAGED_APP_BUNDLE}/Contents/Resources/build/common.ini"
  local temp_path=""

  if [[ "$BOOT_COMMON_OVERLAY" == false ]]; then
    return
  fi

  temp_path="${overlay_path}.tmp"
  {
    printf '; Generated by eve.js stage-offline-client.sh\n'
    printf '; eveprefs merges common.ini after start.ini; keep start.ini and manifest.dat untouched.\n'
    printf '[main]\n'
    printf 'cryptoPack = %s\n' "$BOOT_CRYPTO_PACK"
  } >"$temp_path"
  mv "$temp_path" "$overlay_path"

  echo "[eve.js] Boot overlay: common.ini cryptoPack=$BOOT_CRYPTO_PACK"
}

# --------------------------------------------------------------------------- #
# Remove only the outer app bundle seal after adding common.ini.
# --------------------------------------------------------------------------- #
remove_app_bundle_signature() {
  if [[ "$REMOVE_APP_BUNDLE_SIGNATURE" == false ]]; then
    return
  fi

  require_command codesign

  echo "[eve.js] Removing outer EVE.app bundle signature..."
  codesign --remove-signature "$STAGED_APP_BUNDLE" >/dev/null 2>&1 || true
  APP_BUNDLE_SIGNATURE_MODE="outer-removed"

  echo "[eve.js] Outer bundle signature removed; nested CCP Mach-O signatures preserved."
}

# --------------------------------------------------------------------------- #
# Codesign the staged app bundle.
# --------------------------------------------------------------------------- #
write_exefile_entitlements() {
  local entitlements_path="${STAGED_ROOT}/evejs-exefile-entitlements.plist"

  if [[ "$EXEFILE_ENTITLEMENTS_MODE" == "preserve" ]]; then
    if codesign -d --entitlements :- "$STAGED_EXEFILE" >"$entitlements_path" 2>/dev/null; then
      printf '%s' "$entitlements_path"
      return
    fi
  fi

  cat > "$entitlements_path" <<'PLIST'
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
PLIST
  printf '%s' "$entitlements_path"
}

sign_staged_bundle() {
  local entitlements_path=""

  if [[ "$SIGN_STAGE" == false ]]; then
    echo "[eve.js] Preserving original code-signature bytes (--no-sign/default)."
    return
  fi

  require_command codesign

  entitlements_path="$(write_exefile_entitlements)"

  # Sign all Mach-O files in bin64
  echo "[eve.js] Re-signing Mach-O files in build/bin64..."
  local path=""
  local file_info=""
  while IFS= read -r -d '' path; do
    file_info="$(file -b "$path" 2>/dev/null || true)"
    if [[ "$file_info" != *"Mach-O"* ]]; then
      continue
    fi
    codesign --force --sign "$SIGN_IDENTITY" --timestamp=none \
      --preserve-metadata=identifier,entitlements,flags,runtime \
      "$path"
  done < <(find "$STAGED_BIN64" -maxdepth 1 -type f -print0 | sort -z)

  # Sign exefile with entitlements
  if [[ "$EXEFILE_ENTITLEMENTS_MODE" == "preserve" ]]; then
    echo "[eve.js] Re-signing exefile with preserved stock entitlements..."
  else
    echo "[eve.js] Re-signing exefile with library-validation disabled..."
  fi
  codesign --force --sign "$SIGN_IDENTITY" --timestamp=none \
    --options runtime \
    --entitlements "$entitlements_path" \
    "$STAGED_EXEFILE"

  # Sign the wrapper binary
  if [[ -x "$STAGED_WRAPPER" ]]; then
    echo "[eve.js] Re-signing the app wrapper binary..."
    codesign --force --sign "$SIGN_IDENTITY" --timestamp=none \
      --options runtime \
      "$STAGED_WRAPPER"
  fi

  # Sign the outer app bundle
  echo "[eve.js] Re-signing the staged app bundle..."
  codesign --force --deep --sign "$SIGN_IDENTITY" --timestamp=none \
    --preserve-metadata=identifier,entitlements,flags,runtime \
    "$STAGED_APP_BUNDLE"

  rm -f "$entitlements_path"
}

verify_staged_bundle() {
  if [[ "$SIGN_STAGE" == false ]]; then
    return
  fi

  echo "[eve.js] Verifying staged app bundle..."
  if ! codesign --verify --deep --strict --verbose=4 "$STAGED_APP_BUNDLE" >/dev/null 2>&1; then
    echo "[eve.js] Staged app bundle failed codesign verification:" >&2
    codesign --verify --deep --strict --verbose=4 "$STAGED_APP_BUNDLE" 2>&1 | sed 's/^/  /' >&2
    exit 1
  fi
  echo "[eve.js] Codesign verification: passed."
}

# --------------------------------------------------------------------------- #
# Write the stage metadata file.
# --------------------------------------------------------------------------- #
write_stage_metadata() {
  local source_blue_so="${SOURCE_SHARED_CACHE}/tq/EVE.app/Contents/Resources/build/bin64/blue.so"
  local source_hash=""
  local staged_hash=""
  local patch_state="unpatched"
  local sign_time=""
  local sign_time_json="null"
  local signed_json="false"
  local sign_identity_json="null"
  local sign_mode="none"
  local resfiles_mode="symlink"
  local boot_crypto_pack_json="null"

  if [[ -f "$source_blue_so" ]]; then
    source_hash="$(shasum -a 256 "$source_blue_so" | awk '{print $1}')"
  fi

  if [[ -f "$STAGED_BLUE_SO" ]]; then
    staged_hash="$(shasum -a 256 "$STAGED_BLUE_SO" | awk '{print $1}')"
  fi

  if [[ "$PATCH_BLUE_SO" == true ]]; then
    patch_state="candidate-patched"
  fi

  if [[ "$SIGN_STAGE" == true ]]; then
    sign_time="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    sign_time_json="$(python3 -c "import json, sys; print(json.dumps(sys.argv[1]))" "$sign_time")"
    signed_json="true"
    sign_identity_json="$(python3 -c "import json, sys; print(json.dumps(sys.argv[1]))" "$SIGN_IDENTITY")"
    if [[ "$SIGN_IDENTITY" == "-" ]]; then
      sign_mode="ad-hoc"
    else
      sign_mode="identity"
    fi
    APP_BUNDLE_SIGNATURE_MODE="signed"
  fi

  if [[ "$COPY_RESFILES" == true ]]; then
    resfiles_mode="copy"
  fi

  if [[ "$BOOT_COMMON_OVERLAY" == true ]]; then
    boot_crypto_pack_json="$(python3 -c "import json, sys; print(json.dumps(sys.argv[1]))" "$BOOT_CRYPTO_PACK")"
  fi

  cat > "$METADATA_PATH" <<METADATA
{
  "stageVersion": 2,
  "sourceRoot": $(python3 -c "import json; print(json.dumps('$SOURCE_ROOT'))"),
  "build": "$BUILD_NUMBER",
  "sourceBlueSOSha256": "$source_hash",
  "stagedBlueSOSha256": "$staged_hash",
  "patchState": "$patch_state",
  "signed": $signed_json,
  "signTime": $sign_time_json,
  "signMode": "$sign_mode",
  "signIdentity": $sign_identity_json,
  "exefileEntitlementsMode": "$EXEFILE_ENTITLEMENTS_MODE",
  "bootCommonOverlay": $BOOT_COMMON_OVERLAY,
  "bootCryptoPack": $boot_crypto_pack_json,
  "appBundleSignatureMode": "$APP_BUNDLE_SIGNATURE_MODE",
  "resfilesMode": "$resfiles_mode",
  "entrypoint": "$ENTRYPOINT"
}
METADATA

  echo "[eve.js] Stage metadata written: $METADATA_PATH"
}

# --------------------------------------------------------------------------- #
# Argument parsing.
# --------------------------------------------------------------------------- #
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --staged-root)
      STAGED_BASE="$2"
      shift 2
      ;;
    --patch-blue-so)
      PATCH_BLUE_SO=true
      shift
      ;;
    --copy-resfiles)
      COPY_RESFILES=true
      shift
      ;;
    --clean-stage)
      CLEAN_STAGE=true
      shift
      ;;
    --no-sign)
      SIGN_STAGE=false
      shift
      ;;
    --boot-common-overlay)
      BOOT_COMMON_OVERLAY=true
      shift
      ;;
    --boot-crypto-pack)
      BOOT_CRYPTO_PACK="$2"
      shift 2
      ;;
    --remove-app-bundle-signature)
      REMOVE_APP_BUNDLE_SIGNATURE=true
      shift
      ;;
    --sign)
      SIGN_STAGE=true
      shift
      ;;
    --sign-identity)
      SIGN_STAGE=true
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    --preserve-exefile-entitlements)
      EXEFILE_ENTITLEMENTS_MODE="preserve"
      shift
      ;;
    --no-copy)
      NO_COPY=true
      shift
      ;;
    --entrypoint)
      ENTRYPOINT="$2"
      if [[ "$ENTRYPOINT" != "wrapper" && "$ENTRYPOINT" != "exefile" ]]; then
        echo "[eve.js] --entrypoint must be 'wrapper' or 'exefile', got: $ENTRYPOINT" >&2
        exit 1
      fi
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

# --------------------------------------------------------------------------- #
# Main.
# --------------------------------------------------------------------------- #
SOURCE_SHARED_CACHE="${SOURCE_ROOT}/SharedCache"

require_command ditto
require_command python3

if [[ "$REMOVE_APP_BUNDLE_SIGNATURE" == true && "$SIGN_STAGE" == true ]]; then
  echo "[eve.js] --remove-app-bundle-signature cannot be combined with --sign." >&2
  echo "[eve.js] The outer-signature removal path preserves nested CCP signatures." >&2
  exit 1
fi

if [[ "$REMOVE_APP_BUNDLE_SIGNATURE" == true && "$PATCH_BLUE_SO" == true ]]; then
  echo "[eve.js] --remove-app-bundle-signature cannot be combined with --patch-blue-so." >&2
  echo "[eve.js] The Mac Placebo path requires manifest-tracked Mach-O bytes to remain untouched." >&2
  exit 1
fi

echo "[eve.js] Source root: $SOURCE_ROOT"
source_preflight

BUILD_NUMBER="$(read_build_number)"
echo "[eve.js] Build number: $BUILD_NUMBER"

build_drift_preflight
prepare_staged_root
copy_source_to_stage
strip_staged_local_access_xattrs
setup_resfiles
apply_blue_so_patch
write_boot_common_overlay
sign_staged_bundle
verify_staged_bundle
remove_app_bundle_signature
write_stage_metadata

echo
echo "[eve.js] Staged runtime is ready."
echo "[eve.js] Staged root: $STAGED_ROOT"
echo "[eve.js] Build: $BUILD_NUMBER"
if [[ "$PATCH_BLUE_SO" == true ]]; then
  echo "[eve.js] blue.so: candidate-patched (research only)"
else
  echo "[eve.js] blue.so: unpatched (expected macOS runtime state)"
fi
if [[ "$SIGN_STAGE" == true ]]; then
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    echo "[eve.js] Codesign: ad-hoc re-signed and verified"
  else
    echo "[eve.js] Codesign: re-signed with identity '$SIGN_IDENTITY' and verified"
  fi
  echo "[eve.js] exefile entitlements: $EXEFILE_ENTITLEMENTS_MODE"
else
  echo "[eve.js] Codesign: original bundle bytes preserved"
fi
if [[ "$BOOT_COMMON_OVERLAY" == true ]]; then
  echo "[eve.js] Boot overlay: common.ini cryptoPack=$BOOT_CRYPTO_PACK"
fi
if [[ "$APP_BUNDLE_SIGNATURE_MODE" == "outer-removed" ]]; then
  echo "[eve.js] App bundle signature: outer seal removed; nested signatures preserved"
fi
if [[ "$PATCH_BLUE_SO" == true && "$SIGN_STAGE" == false ]]; then
  echo "[eve.js] Warning: patched binaries usually need --sign to satisfy macOS loader checks."
fi
echo
echo "[eve.js] Launch the staged runtime:"
if [[ -f "$LAUNCH_HELPER" ]]; then
  echo "  bash \"$LAUNCH_HELPER\" --settings-profile EvEJSLocal"
else
  echo "  bash \"$REPO_ROOT/tools/macos/launch-offline-client.sh\" --settings-profile EvEJSLocal"
fi
if [[ "$PATCH_BLUE_SO" == false ]]; then
  echo "[eve.js] Unpatched staged runtime: start the server in default stock-client mode:"
  echo "  bash \"$REPO_ROOT/QuickstartServer.sh\""
else
  echo "[eve.js] Patched staged runtime: start the server in patched-client research mode:"
  echo "  bash \"$REPO_ROOT/QuickstartServer.sh\" --patched-client"
fi
echo "[eve.js] Rebuild from scratch:"
echo "  bash \"${BASH_SOURCE[0]}\" --source-root \"$SOURCE_ROOT\" --clean-stage"
