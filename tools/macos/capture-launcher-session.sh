#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
CONFIG_SCRIPT="${REPO_ROOT}/tools/macos/scripts/EvEJSConfig.sh"

if [[ -f "$CONFIG_SCRIPT" ]]; then
  # shellcheck disable=SC1090
  . "$CONFIG_SCRIPT"
fi

DEFAULT_CAPTURE_DIR="${HOME}/Library/Application Support/eve.js/macos"
DEFAULT_OUTPUT_FILE="${EVEJS_MAC_SESSION_FILE:-${DEFAULT_CAPTURE_DIR}/launcher-session.args}"
OUTPUT_FILE="${DEFAULT_OUTPUT_FILE}"
TIMEOUT_SECONDS=180
POLL_INTERVAL_SECONDS=1
OPEN_LAUNCHER=false
LAUNCHER_APP=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/capture-launcher-session.sh [options]

Waits for the retail CCP launcher to start the native-mac EVE client, captures
the launcher-style client args from the live process list, and writes them to a
local args file that launch-offline-client.sh can replay against eve.js.

Options:
  --output <path>     Destination args file. Default: ~/Library/Application Support/eve.js/macos/launcher-session.args
  --timeout <sec>     How long to wait for the launcher session. Default: 180
  --open-launcher     Try to open the retail CCP launcher before waiting.
  --launcher-app <p>  Launcher app path to open. Required if auto-detect fails.
  --help              Show this help text.
EOF
}

trim_leading_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  printf '%s' "$value"
}

find_launcher_command() {
  local line=""
  local trimmed=""
  local pid=""
  local command=""
  local best_pid=0
  local best_command=""
  local ps_output=""

  if ! ps_output="$(ps -axww -o pid= -o command= 2>/dev/null)"; then
    echo "[eve.js] Could not inspect the process list with ps." >&2
    echo "[eve.js] Grant the launching terminal permission to inspect processes, then retry capture." >&2
    return 1
  fi

  while IFS= read -r line; do
    trimmed="$(trim_leading_whitespace "$line")"
    [[ -z "$trimmed" ]] && continue

    pid="${trimmed%% *}"
    command="${trimmed#"$pid"}"
    command="$(trim_leading_whitespace "$command")"

    if [[ "$command" != *"/ssoToken="* ]]; then
      continue
    fi
    if [[ "$command" != *"/refreshToken="* ]]; then
      continue
    fi
    if [[ "$command" != *"/LauncherData="* ]]; then
      continue
    fi

    if [[ "$pid" =~ ^[0-9]+$ ]] && (( pid > best_pid )); then
      best_pid="$pid"
      best_command="$command"
    fi
  done <<< "$ps_output"

  printf '%s' "$best_command"
}

resolve_launcher_app() {
  local explicit_path="$1"
  local candidate=""
  local candidates=(
    "$explicit_path"
    "/Applications/EVE Launcher.app"
    "$HOME/Applications/EVE Launcher.app"
    "/Applications/EVE Online Launcher.app"
    "$HOME/Applications/EVE Online Launcher.app"
    "/Applications/CCP Launcher.app"
    "$HOME/Applications/CCP Launcher.app"
    "/Applications/EVE Online.app"
    "$HOME/Applications/EVE Online.app"
    "/Applications/eve-online.app"
    "$HOME/Applications/eve-online.app"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -d "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

start_launcher() {
  local launcher_path=""
  launcher_path="$(resolve_launcher_app "$LAUNCHER_APP" || true)"

  if [[ -z "$launcher_path" ]]; then
    echo "[eve.js] Could not auto-detect the retail launcher app." >&2
    echo "[eve.js] Re-run with an explicit app bundle path, for example:" >&2
    echo "  bash \"$REPO_ROOT/tools/macos/capture-launcher-session.sh\" --open-launcher --launcher-app \"/path/to/Your Launcher.app\"" >&2
    exit 1
  fi

  echo "[eve.js] Opening retail launcher:"
  echo "  $launcher_path"
  open -n -a "$launcher_path"
}

write_session_args() {
  local command_line="$1"
  local output_path="$2"
  local temp_path=""
  local token=""
  local tokens=()
  local arg_noconsole=""
  local arg_server=""
  local arg_sso=""
  local arg_refresh=""
  local arg_settings=""
  local arg_language=""
  local arg_launcher_data=""
  local arg_device=""
  local arg_machine_hash=""
  local arg_journey=""
  local arg_exp=""

  IFS=' ' read -r -a tokens <<< "$command_line"
  for token in "${tokens[@]}"; do
    case "$token" in
      /noconsole)
        arg_noconsole="$token"
        ;;
      /server:*)
        arg_server="$token"
        ;;
      /ssoToken=*)
        arg_sso="$token"
        ;;
      /refreshToken=*)
        arg_refresh="$token"
        ;;
      /settingsprofile=*)
        arg_settings="$token"
        ;;
      /language=*)
        arg_language="$token"
        ;;
      /LauncherData=*)
        arg_launcher_data="$token"
        ;;
      /deviceID=*)
        arg_device="$token"
        ;;
      /machineHash=*)
        arg_machine_hash="$token"
        ;;
      /journeyID=*)
        arg_journey="$token"
        ;;
      exp=*)
        arg_exp="$token"
        ;;
    esac
  done

  if [[ -z "$arg_sso" || -z "$arg_refresh" || -z "$arg_launcher_data" ]]; then
    echo "[eve.js] Found an EVE client process, but it did not expose the launcher args we need." >&2
    return 1
  fi

  mkdir -p "$(dirname "$output_path")"
  temp_path="$(mktemp "${output_path}.tmp.XXXXXX")"

  {
    echo "# Captured from the live CCP launcher on $(date '+%Y-%m-%d %H:%M:%S')"
    echo "# Reuse with: bash \"$REPO_ROOT/tools/macos/launch-offline-client.sh\" --use-captured-session"
    [[ -n "$arg_noconsole" ]] && echo "$arg_noconsole"
    [[ -n "$arg_server" ]] && echo "$arg_server"
    [[ -n "$arg_sso" ]] && echo "$arg_sso"
    [[ -n "$arg_refresh" ]] && echo "$arg_refresh"
    [[ -n "$arg_settings" ]] && echo "$arg_settings"
    [[ -n "$arg_language" ]] && echo "$arg_language"
    [[ -n "$arg_launcher_data" ]] && echo "$arg_launcher_data"
    [[ -n "$arg_device" ]] && echo "$arg_device"
    [[ -n "$arg_machine_hash" ]] && echo "$arg_machine_hash"
    [[ -n "$arg_journey" ]] && echo "$arg_journey"
    [[ -n "$arg_exp" ]] && echo "$arg_exp"
  } > "$temp_path"

  chmod 600 "$temp_path"
  mv "$temp_path" "$output_path"

  echo "[eve.js] Captured launcher session: $output_path"
  echo "[eve.js] Sanitized args:"
  [[ -n "$arg_noconsole" ]] && echo "  $arg_noconsole"
  [[ -n "$arg_server" ]] && echo "  $arg_server"
  [[ -n "$arg_sso" ]] && echo "  /ssoToken=***"
  [[ -n "$arg_refresh" ]] && echo "  /refreshToken=***"
  [[ -n "$arg_settings" ]] && echo "  $arg_settings"
  [[ -n "$arg_language" ]] && echo "  $arg_language"
  [[ -n "$arg_launcher_data" ]] && echo "  /LauncherData=***"
  [[ -n "$arg_device" ]] && echo "  /deviceID=***"
  [[ -n "$arg_machine_hash" ]] && echo "  /machineHash=***"
  [[ -n "$arg_journey" ]] && echo "  /journeyID=***"
  [[ -n "$arg_exp" ]] && echo "  $arg_exp"
  echo "[eve.js] Next step:"
  echo "  bash \"$REPO_ROOT/tools/macos/launch-offline-client.sh\" --use-captured-session --settings-profile EvEJSLocal"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --open-launcher)
      OPEN_LAUNCHER=true
      shift
      ;;
    --launcher-app)
      LAUNCHER_APP="$2"
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

if ! [[ "$TIMEOUT_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[eve.js] Timeout must be an integer number of seconds." >&2
  exit 1
fi

if [[ "$OPEN_LAUNCHER" == true ]]; then
  start_launcher
fi

echo "[eve.js] Waiting up to ${TIMEOUT_SECONDS}s for the CCP launcher to start EVE..."
echo "[eve.js] When ready, click Play in the retail launcher."

START_TIME="$(date +%s)"
while true; do
  if ! command_line="$(find_launcher_command)"; then
    exit 1
  fi
  if [[ -n "$command_line" ]]; then
    write_session_args "$command_line" "$OUTPUT_FILE"
    exit 0
  fi

  NOW="$(date +%s)"
  if (( NOW - START_TIME >= TIMEOUT_SECONDS )); then
    echo "[eve.js] Timed out waiting for a launcher-started EVE client." >&2
    exit 1
  fi

  sleep "$POLL_INTERVAL_SECONDS"
done
