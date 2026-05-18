#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_SCRIPT="${REPO_ROOT}/tools/macos/scripts/EvEJSConfig.sh"
PREPARE_HELPER="${REPO_ROOT}/tools/macos/prepare-offline-client.sh"
STAGE_HELPER="${REPO_ROOT}/tools/macos/stage-offline-client.sh"
INSTALL_CA_HELPER="${REPO_ROOT}/tools/macos/install-local-ca.sh"
CAPTURE_HELPER="${REPO_ROOT}/tools/macos/capture-launcher-session.sh"

if [[ ! -f "$CONFIG_SCRIPT" ]]; then
  echo "[eve.js] Missing config helper: $CONFIG_SCRIPT" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CONFIG_SCRIPT"

SOURCE_ROOT="$EVEJS_MAC_SOURCE_ROOT"
RETAIL_ROOT="$EVEJS_MAC_RETAIL_ROOT"
STAGED_BASE="$EVEJS_MAC_STAGED_BASE"
SESSION_FILE="$EVEJS_MAC_SESSION_FILE"
SETTINGS_PROFILE="$EVEJS_MAC_SETTINGS_PROFILE"
SERVER_HOST="$EVEJS_SERVER_HOST"
PROXY_URL="$EVEJS_PROXY_URL"

INSTALL_CA=true
CLEAN_STAGE=true
COPY_RESFILES=false
PLACEBO_BOOT=true
CAPTURE_SESSION=false
OPEN_LAUNCHER=false
LAUNCHER_APP=""
CAPTURE_TIMEOUT_SECONDS=180
RETAIL_ROOT_SOURCE="configured"
STEP_INDEX=0

usage() {
  cat <<'EOF'
Usage: bash tools/macos/StartClientSetup.sh [options]

One-shot setup for the macOS staged-client flow. This mirrors the Windows
Client Setup philosophy:
  1. prepare an isolated source copy
  2. build a byte-preserving staged runtime
  3. install the eve.js local CA
  4. save the paths for Play.sh

Options:
  --source-root <dir>      Source-copy destination. Default:
                           ~/Library/Application Support/eve.js/macos/source-client
  --retail-root <dir>      Retail EVE root containing SharedCache, or the
                           SharedCache directory itself. Default: auto-detect
                           common EVE Online install locations.
  --staged-base <dir>      Base directory for local staged runtimes. Default:
                           ~/Library/Application Support/eve.js/macos/staged-client
  --session-file <path>    Captured launcher-session args file. Default:
                           ~/Library/Application Support/eve.js/macos/launcher-session.args
  --settings-profile <id>  Client settings profile. Default: EvEJSLocal
  --server-host <host>     Server host passed at launch. Default: 127.0.0.1
  --proxy-url <url>        Local proxy URL passed at launch. Default:
                           http://127.0.0.1:26002
  --copy-resfiles          Fully copy ResFiles into the staged runtime instead
                           of symlinking them to the local source copy.
  --stock-cryptoapi        Stage a byte-preserving stock CryptoAPI runtime
                           instead of the default Mac Placebo boot overlay.
  --no-clean-stage         Reuse the existing staged build directory.
  --skip-install-ca        Skip login-keychain CA trust installation.
  --capture-session        After setup, wait for a retail launcher-started EVE
                           process and save replayable private session args.
  --open-launcher          Try to open the retail launcher before capture.
                           Implies --capture-session.
  --launcher-app <path>    Retail launcher app bundle for --open-launcher.
  --capture-timeout <sec>  Capture wait timeout. Default: 180.
  --help                   Show this help text.
EOF
}

display_path() {
  local path="$1"
  if [[ "$path" == "$HOME" ]]; then
    printf '~'
  elif [[ "$path" == "$HOME/"* ]]; then
    printf '~/%s' "${path#"$HOME/"}"
  else
    printf '%s' "$path"
  fi
}

require_value() {
  local option="$1"
  local value="${2:-}"

  if [[ -z "$value" || "$value" == --* ]]; then
    echo "[eve.js] $option requires a value." >&2
    usage >&2
    exit 2
  fi
}

absolute_path() {
  local path="$1"

  case "$path" in
    /*)
      printf '%s' "$path"
      ;;
    *)
      printf '%s/%s' "$PWD" "$path"
      ;;
  esac
}

path_is_under_repo() {
  local path="$1"
  case "$path" in
    "$REPO_ROOT"|"$REPO_ROOT"/*)
      return 0
      ;;
  esac
  return 1
}

is_git_ignored() {
  local path="$1"
  git -C "$REPO_ROOT" check-ignore -q "$path" >/dev/null 2>&1
}

ensure_private_path_safe() {
  local path="$1"
  local label="$2"

  if path_is_under_repo "$path" && ! is_git_ignored "$path"; then
    echo "[eve.js] Refusing to write private $label inside the tracked repo:" >&2
    echo "  $path" >&2
    echo "[eve.js] Choose an ignored path or the default Application Support location." >&2
    exit 1
  fi
}

is_retail_root() {
  local root="$1"

  [[ -n "$root" ]] || return 1
  if [[ -d "${root}/SharedCache/tq/EVE.app" ]]; then
    return 0
  fi
  if [[ "$(basename "$root")" == "SharedCache" && -d "${root}/tq/EVE.app" ]]; then
    return 0
  fi

  return 1
}

normalize_retail_root() {
  local root="$1"

  if [[ "$(basename "$root")" == "SharedCache" && -d "${root}/tq/EVE.app" ]]; then
    dirname "$root"
  else
    printf '%s' "$root"
  fi
}

resolve_retail_root() {
  local configured="$RETAIL_ROOT"
  local candidate=""
  local candidates=(
    "$configured"
    "$EVEJS_MAC_DEFAULT_RETAIL_ROOT"
    "${HOME}/Library/Application Support/EVE Online"
    "${HOME}/Library/Application Support/CCP/EVE Online"
    "${HOME}/Library/Application Support/CCP/EVE"
    "/Users/Shared/EVE Online"
  )

  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] || continue
    if is_retail_root "$candidate"; then
      RETAIL_ROOT="$(normalize_retail_root "$candidate")"
      if [[ "$candidate" == "$configured" ]]; then
        RETAIL_ROOT_SOURCE="configured"
      else
        RETAIL_ROOT_SOURCE="auto-detected"
      fi
      return 0
    fi
  done

  echo "[eve.js] Could not find a retail EVE install with SharedCache/tq/EVE.app." >&2
  echo "[eve.js] Checked:" >&2
  for candidate in "${candidates[@]}"; do
    [[ -n "$candidate" ]] && echo "  $(display_path "$candidate")" >&2
  done
  echo "[eve.js] Re-run with --retail-root <path>." >&2
  exit 1
}

print_step() {
  local total_steps="$1"
  local title="$2"

  STEP_INDEX=$((STEP_INDEX + 1))
  echo
  echo "[eve.js] Step ${STEP_INDEX}/${total_steps}: $title"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-root)
      require_value "$1" "${2:-}"
      SOURCE_ROOT="$2"
      shift 2
      ;;
    --retail-root)
      require_value "$1" "${2:-}"
      RETAIL_ROOT="$2"
      shift 2
      ;;
    --staged-base)
      require_value "$1" "${2:-}"
      STAGED_BASE="$2"
      shift 2
      ;;
    --session-file)
      require_value "$1" "${2:-}"
      SESSION_FILE="$2"
      shift 2
      ;;
    --settings-profile)
      require_value "$1" "${2:-}"
      SETTINGS_PROFILE="$2"
      shift 2
      ;;
    --server-host)
      require_value "$1" "${2:-}"
      SERVER_HOST="$2"
      shift 2
      ;;
    --proxy-url)
      require_value "$1" "${2:-}"
      PROXY_URL="$2"
      shift 2
      ;;
    --copy-resfiles)
      COPY_RESFILES=true
      shift
      ;;
    --stock-cryptoapi)
      PLACEBO_BOOT=false
      shift
      ;;
    --no-clean-stage)
      CLEAN_STAGE=false
      shift
      ;;
    --skip-install-ca)
      INSTALL_CA=false
      shift
      ;;
    --capture-session)
      CAPTURE_SESSION=true
      shift
      ;;
    --open-launcher)
      CAPTURE_SESSION=true
      OPEN_LAUNCHER=true
      shift
      ;;
    --launcher-app)
      require_value "$1" "${2:-}"
      CAPTURE_SESSION=true
      LAUNCHER_APP="$2"
      shift 2
      ;;
    --capture-timeout)
      require_value "$1" "${2:-}"
      CAPTURE_SESSION=true
      CAPTURE_TIMEOUT_SECONDS="$2"
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

if ! [[ "$CAPTURE_TIMEOUT_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[eve.js] --capture-timeout must be an integer number of seconds." >&2
  exit 2
fi

resolve_retail_root
SESSION_FILE="$(absolute_path "$SESSION_FILE")"
ensure_private_path_safe "$EVEJS_MAC_LOCAL_CONFIG_PATH" "macOS config"
ensure_private_path_safe "$SESSION_FILE" "launcher session args"

persist_local_config() {
  local local_config_path="$EVEJS_MAC_LOCAL_CONFIG_PATH"
  local tmp_path=""

  mkdir -p "$(dirname "$local_config_path")"
  tmp_path="$(mktemp "${local_config_path}.tmp.XXXXXX")"
  {
    echo "#!/usr/bin/env bash"
    echo "# Local macOS EvEJS paths. Generated by StartClientSetup.sh."
    printf 'export EVEJS_MAC_SOURCE_ROOT=%q\n' "$SOURCE_ROOT"
    printf 'export EVEJS_MAC_RETAIL_ROOT=%q\n' "$RETAIL_ROOT"
    printf 'export EVEJS_MAC_STAGED_BASE=%q\n' "$STAGED_BASE"
    printf 'export EVEJS_MAC_STAGED_ROOT=%q\n' "${STAGED_BASE}/current"
    printf 'export EVEJS_MAC_SESSION_FILE=%q\n' "$SESSION_FILE"
    printf 'export EVEJS_MAC_SETTINGS_PROFILE=%q\n' "$SETTINGS_PROFILE"
    printf 'export EVEJS_SERVER_HOST=%q\n' "$SERVER_HOST"
    printf 'export EVEJS_PROXY_URL=%q\n' "$PROXY_URL"
  } >"$tmp_path"
  mv "$tmp_path" "$local_config_path"
  chmod 600 "$local_config_path"
}

validate_setup_outputs() {
  local staged_root="${STAGED_BASE}/current"
  local source_app="${SOURCE_ROOT}/SharedCache/tq/EVE.app"
  local staged_app="${staged_root}/SharedCache/tq/EVE.app"
  local exefile="${staged_app}/Contents/Resources/build/bin64/exefile"
  local metadata_path="${staged_root}/.evejs-stage-metadata.json"
  local resfiles_path="${staged_root}/SharedCache/ResFiles"
  local common_ini="${staged_app}/Contents/Resources/build/common.ini"
  local metadata_summary=""

  [[ -d "$source_app" ]] || {
    echo "[eve.js] Setup validation failed: source EVE.app not found at $source_app" >&2
    exit 1
  }

  [[ -d "$staged_app" && -f "$exefile" ]] || {
    echo "[eve.js] Setup validation failed: staged EVE.app or exefile is missing under $staged_root" >&2
    exit 1
  }

  [[ -f "$metadata_path" ]] || {
    echo "[eve.js] Setup validation failed: stage metadata missing at $metadata_path" >&2
    exit 1
  }

  if ! metadata_summary="$(
    python3 -c '
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
print("stageVersion={stageVersion} build={build} patch={patchState} resfiles={resfilesMode} entrypoint={entrypoint}".format(
    stageVersion=d.get("stageVersion", ""),
    build=d.get("build", ""),
    patchState=d.get("patchState", ""),
    resfilesMode=d.get("resfilesMode", ""),
    entrypoint=d.get("entrypoint", ""),
))
' "$metadata_path"
  )"; then
    echo "[eve.js] Setup validation failed: could not parse stage metadata at $metadata_path" >&2
    exit 1
  fi

  if [[ "$metadata_summary" != stageVersion=2\ * ]]; then
    echo "[eve.js] Setup validation failed: unexpected stage metadata: $metadata_summary" >&2
    exit 1
  fi

  if [[ "$COPY_RESFILES" == true ]]; then
    [[ -d "$resfiles_path" && ! -L "$resfiles_path" ]] || {
      echo "[eve.js] Setup validation failed: ResFiles copy is missing at $resfiles_path" >&2
      exit 1
    }
  else
    [[ -L "$resfiles_path" && -d "$resfiles_path" ]] || {
      echo "[eve.js] Setup validation failed: ResFiles symlink is missing or broken at $resfiles_path" >&2
      exit 1
    }
  fi

  if [[ "$PLACEBO_BOOT" == true ]]; then
    if [[ ! -f "$common_ini" || "$(grep -E '^[[:space:]]*cryptoPack[[:space:]]*=[[:space:]]*Placebo[[:space:]]*$' "$common_ini" || true)" == "" ]]; then
      echo "[eve.js] Setup validation failed: generated common.ini Placebo boot overlay is missing." >&2
      exit 1
    fi
  fi

  echo "[eve.js] Validation: $metadata_summary"
  if [[ "$PLACEBO_BOOT" == true ]]; then
    echo "[eve.js] Validation: source, staged runtime, ResFiles, and boot overlay are ready."
  else
    echo "[eve.js] Validation: source, staged runtime, and ResFiles are ready."
  fi
}

run_capture_session() {
  local capture_args=(
    --output "$SESSION_FILE"
    --timeout "$CAPTURE_TIMEOUT_SECONDS"
  )

  if [[ "$OPEN_LAUNCHER" == true ]]; then
    capture_args+=(--open-launcher)
  fi
  if [[ -n "$LAUNCHER_APP" ]]; then
    capture_args+=(--launcher-app "$LAUNCHER_APP")
  fi

  bash "$CAPTURE_HELPER" "${capture_args[@]}"
}

print_next_steps() {
  echo
  echo "[eve.js] Next steps:"
  echo "  bash \"$REPO_ROOT/tools/macos/doctor.sh\" --check"
  echo "  bash \"$REPO_ROOT/QuickstartServer.sh\""
  if [[ -f "$SESSION_FILE" ]]; then
    echo "  bash \"$REPO_ROOT/Play.sh\" --use-captured-session"
  else
    echo "  bash \"$REPO_ROOT/tools/macos/capture-launcher-session.sh\" --output \"$SESSION_FILE\""
    echo "  bash \"$REPO_ROOT/Play.sh\" --use-captured-session"
  fi
}

stage_args=(
  --source-root "$SOURCE_ROOT"
  --staged-root "$STAGED_BASE"
)

if [[ "$CLEAN_STAGE" == true ]]; then
  stage_args+=(--clean-stage)
fi

if [[ "$COPY_RESFILES" == true ]]; then
  stage_args+=(--copy-resfiles)
fi

if [[ "$PLACEBO_BOOT" == true ]]; then
  stage_args+=(--boot-common-overlay --boot-crypto-pack Placebo --remove-app-bundle-signature)
fi

TOTAL_STEPS=5
if [[ "$CAPTURE_SESSION" == true ]]; then
  TOTAL_STEPS=6
fi

echo "[eve.js] macOS client setup"
echo "[eve.js] Repo: $REPO_ROOT"
echo "[eve.js] Retail root: $(display_path "$RETAIL_ROOT") ($RETAIL_ROOT_SOURCE; override with --retail-root)"
echo "[eve.js] Source copy: $(display_path "$SOURCE_ROOT")"
echo "[eve.js] Staged runtime: $(display_path "$STAGED_BASE")/current"
echo "[eve.js] Session args: $(display_path "$SESSION_FILE")"
echo "[eve.js] Local config: $(display_path "$EVEJS_MAC_LOCAL_CONFIG_PATH")"

print_step "$TOTAL_STEPS" "Prepare isolated source copy"
bash "$PREPARE_HELPER" --retail-root "$RETAIL_ROOT" --dest "$SOURCE_ROOT"

if [[ "$PLACEBO_BOOT" == true ]]; then
  print_step "$TOTAL_STEPS" "Build staged runtime with Mac Placebo boot overlay"
else
  print_step "$TOTAL_STEPS" "Build byte-preserving staged runtime"
fi
bash "$STAGE_HELPER" "${stage_args[@]}"

print_step "$TOTAL_STEPS" "Configure local CA trust"
if [[ "$INSTALL_CA" == true ]]; then
  bash "$INSTALL_CA_HELPER"
else
  echo "[eve.js] Skipped login-keychain CA installation (--skip-install-ca)."
  echo "[eve.js] Install later with:"
  echo "  bash \"$INSTALL_CA_HELPER\""
fi

print_step "$TOTAL_STEPS" "Save ignored local config"
persist_local_config
echo "[eve.js] Saved local config: $(display_path "$EVEJS_MAC_LOCAL_CONFIG_PATH")"
echo "[eve.js] Local config permissions: 600"

print_step "$TOTAL_STEPS" "Validate staged runtime"
validate_setup_outputs

if [[ "$CAPTURE_SESSION" == true ]]; then
  print_step "$TOTAL_STEPS" "Capture launcher session args"
  run_capture_session
fi

echo "[eve.js] macOS client setup is complete."
echo "[eve.js] Source root: $(display_path "$SOURCE_ROOT")"
echo "[eve.js] Retail root: $(display_path "$RETAIL_ROOT")"
echo "[eve.js] Staged root: $(display_path "${STAGED_BASE}/current")"
if [[ "$INSTALL_CA" == false ]]; then
  echo "[eve.js] CA trust: skipped"
else
  echo "[eve.js] CA trust: installed or already trusted"
fi
if [[ -f "$SESSION_FILE" ]]; then
  echo "[eve.js] Launcher session: $(display_path "$SESSION_FILE")"
else
  echo "[eve.js] Launcher session: not captured yet"
fi
print_next_steps
