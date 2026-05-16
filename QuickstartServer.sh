#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$REPO_ROOT/server"
MARKET_SEED_DIR="$REPO_ROOT/tools/market-seed"
MARKET_SERVER_DIR="$REPO_ROOT/externalservices/market-server"
MARKET_DB_PATH="$MARKET_SERVER_DIR/data/generated/market.sqlite"
STATIC_DATA_SENTINEL="$SERVER_DIR/src/newDatabase/data/solarSystems/data.json"
RUNTIME_DATA_SENTINEL="$SERVER_DIR/src/newDatabase/data/accounts/data.json"
CA_CERT_PATH="$REPO_ROOT/server/certs/xmpp-ca-cert.pem"
CA_KEY_PATH="$REPO_ROOT/server/certs/xmpp-ca-key.pem"
GATEWAY_CERT_DIR="$SERVER_DIR/var/certs/gateway"
GATEWAY_CERT_PATH="$GATEWAY_CERT_DIR/gateway-dev-cert.pem"
GATEWAY_KEY_PATH="$GATEWAY_CERT_DIR/gateway-dev-key.pem"
GATEWAY_CERT_BUILDER="$REPO_ROOT/tools/macos/build-gateway-cert.sh"
HOST_PLATFORM="$(uname -s)"
GATEWAY_CERT_REQUIRED_HOSTS=(
  "dev-public-gateway.evetech.net"
  "live-public-gateway.evetech.net"
  "public-gateway.evetech.net"
  "localhost"
)

market_mode="none"
market_pid=""
if [[ -n "${EVEJS_CLIENT_HANDSHAKE_MODE:-}" ]]; then
  client_handshake_mode="$EVEJS_CLIENT_HANDSHAKE_MODE"
elif [[ "$HOST_PLATFORM" == "Darwin" ]]; then
  client_handshake_mode="stock"
else
  client_handshake_mode="patched"
fi
proxy_local_intercept="${EVEJS_PROXY_LOCAL_INTERCEPT:-1}"

usage() {
  cat <<'EOF'
Usage: ./QuickstartServer.sh [--patched-client] [--stock-client] [--remote-gateway] [--market-smoke|--market-jita] [--help]

Starts a local EvEJS dev server on macOS/Linux.

Default mode is platform-sensitive:
  - macOS (`Darwin`): stock-client staged-runtime workflow
  - other platforms: upstream patched-client workflow

In both cases local proxy/gateway interception stays enabled by default.

Options:
  --patched-client
                  Research mode for explicitly patched clients. Enables the
                  handshake-time signedFunc injection path used by the Windows
                  Placebo client flow.
  --stock-client  Explicitly force the stock-client handshake path. This is
                  the default and disables handshake-time signedFunc injection
                  for untouched native Mac clients.
  --remote-gateway
                  Do not locally intercept public-gateway gRPC. Mostly useful
                  while debugging the stock-client path.
  --market-smoke  Build a tiny smoke-test market DB, start the market daemon,
                  then start the main server.
  --market-jita   Build a Jita + New Caldari market DB, start the market
                  daemon, then start the main server.
  --help          Show this help text.
EOF
}

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "[eve.js] Missing required command: $name" >&2
    exit 1
  fi
}

cleanup() {
  if [[ -n "$market_pid" ]]; then
    kill "$market_pid" >/dev/null 2>&1 || true
    wait "$market_pid" >/dev/null 2>&1 || true
  fi
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

url_port_or_default() {
  local url="${1:-}"
  local fallback="$2"

  if [[ "$url" =~ :([0-9]+)(/|$) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return
  fi

  printf '%s' "$fallback"
}

gateway_mode_summary() {
  local configured_mode="${EVEJS_PROXY_GATEWAY_MODE:-}"
  local normalized_mode=""

  if [[ "$proxy_local_intercept" != "1" ]]; then
    printf 'transparent remote gateway (--remote-gateway)'
    return
  fi

  normalized_mode="$(printf '%s' "$configured_mode" | tr '[:upper:]' '[:lower:]')"
  if [[ "$normalized_mode" == "forward" && -n "${EVEJS_PROXY_UPSTREAM_BASE_URL:-}" ]]; then
    printf 'forward local intercept to %s' "$EVEJS_PROXY_UPSTREAM_BASE_URL"
    return
  fi

  printf 'local public-gateway intercept'
}

market_daemon_is_reachable() {
  (: >/dev/tcp/127.0.0.1/40111) >/dev/null 2>&1
}

market_state_summary() {
  if [[ "$market_mode" == "smoke" ]]; then
    printf 'auto-start smoke seed; HTTP 127.0.0.1:40110, RPC 127.0.0.1:40111'
    return
  fi

  if [[ "$market_mode" == "jita" ]]; then
    printf 'auto-start Jita/New Caldari seed; HTTP 127.0.0.1:40110, RPC 127.0.0.1:40111'
    return
  fi

  if market_daemon_is_reachable; then
    printf 'already reachable at 127.0.0.1:40111; not started by this script'
    return
  fi

  if [[ -f "$MARKET_DB_PATH" ]]; then
    printf 'not started; local DB exists, pass --market-smoke or --market-jita to enable seeded market'
  else
    printf 'not started; market UI may be limited, pass --market-smoke to build a tiny seed'
  fi
}

print_runtime_summary() {
  local proxy_http_url="${EVEJS_MICROSERVICES_PUBLIC_BASE_URL:-http://127.0.0.1:26002/}"
  local proxy_http_port=""
  local gateway_https_port=""
  local allowed_hosts="${EVEJS_PROXY_ALLOWED_HOSTS:-}"
  local unhandled_policy="${EVEJS_PROXY_UNHANDLED_HOST_POLICY:-block}"
  local market_reachable=false

  proxy_http_port="$(url_port_or_default "$proxy_http_url" 26002)"
  gateway_https_port=$((proxy_http_port + 1))
  if [[ "$market_mode" == "none" ]] && market_daemon_is_reachable; then
    market_reachable=true
  fi

  echo
  echo "[eve.js] Runtime summary:"
  echo "  platform:        $HOST_PLATFORM"
  echo "  game server:     0.0.0.0:${EVEJS_SERVER_PORT:-26000}"
  echo "  handshake:       $EVEJS_CLIENT_HANDSHAKE_MODE"
  echo "  gateway mode:    $(gateway_mode_summary)"
  echo "  proxy HTTP:      $proxy_http_url"
  echo "  gateway HTTPS:   127.0.0.1:${gateway_https_port}"
  echo "  gateway cert:    $(display_path "$EVEJS_GATEWAY_CERT_PATH")"
  echo "  CDN allow-list:  ${allowed_hosts:-none}"
  echo "  unhandled proxy: $unhandled_policy"
  echo "  market daemon:   $(market_state_summary)"
  if [[ "$EVEJS_CLIENT_HANDSHAKE_MODE" == "stock" ]]; then
    echo "  client path:     stock native/staged client; signedFunc injection disabled"
  else
    echo "  client path:     patched-client research flow; signedFunc injection enabled"
  fi
  echo
  echo "[eve.js] Expected nonfatal noise:"
  echo "  - proxy blocks for telemetry or unhandled hosts are policy decisions, not launch blockers"
  if [[ "$market_mode" == "none" && "$market_reachable" != true ]]; then
    echo "  - market daemon offline warnings are expected until you use --market-smoke or --market-jita"
  fi
}

gateway_cert_needs_rebuild() {
  local san_output=""
  local required_host=""

  if [[ ! -f "$GATEWAY_CERT_PATH" || ! -f "$GATEWAY_KEY_PATH" ]]; then
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    return 1
  fi

  san_output="$(openssl x509 -in "$GATEWAY_CERT_PATH" -noout -ext subjectAltName 2>/dev/null || true)"
  for required_host in "${GATEWAY_CERT_REQUIRED_HOSTS[@]}"; do
    if [[ "$san_output" != *"DNS:${required_host}"* ]]; then
      return 0
    fi
  done

  if ! openssl x509 -in "$GATEWAY_CERT_PATH" -noout -subject -nameopt RFC2253 2>/dev/null |
    grep -q "CN=live-public-gateway.evetech.net"; then
    return 0
  fi

  if ! openssl x509 -in "$GATEWAY_CERT_PATH" -noout -checkend 86400 >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

ensure_gateway_cert() {
  if [[ ! -f "$CA_CERT_PATH" || ! -f "$CA_KEY_PATH" || ! -f "$GATEWAY_CERT_BUILDER" ]]; then
    return
  fi

  if ! gateway_cert_needs_rebuild; then
    return
  fi

  echo "[eve.js] Building local gateway TLS cert..."
  mkdir -p "$GATEWAY_CERT_DIR"
  bash "$GATEWAY_CERT_BUILDER" \
    --ca-cert "$CA_CERT_PATH" \
    --ca-key "$CA_KEY_PATH" \
    --out-cert "$GATEWAY_CERT_PATH" \
    --out-key "$GATEWAY_KEY_PATH"
}

wait_for_market() {
  local attempts=30
  local url="http://127.0.0.1:40110/health"

  require_command curl

  for ((i = 0; i < attempts; i += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "[eve.js] Market daemon did not become healthy at $url" >&2
  return 1
}

ensure_node_deps_and_data() {
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    echo "[eve.js] Installing root dependencies..."
    npm --prefix "$REPO_ROOT" ci
  fi

  if [[ ! -d "$SERVER_DIR/node_modules" ]]; then
    echo "[eve.js] Installing server dependencies..."
    npm --prefix "$SERVER_DIR" ci
  fi

  if [[ ! -f "$RUNTIME_DATA_SENTINEL" ]]; then
    echo "[eve.js] Creating local runtime database baseline..."
    npm --prefix "$REPO_ROOT" run db:bootstrap:apply
  fi

  if [[ ! -s "$STATIC_DATA_SENTINEL" ]]; then
    echo "[eve.js] Generated SDE data is missing. Downloading and applying current JSONL SDE..."
    npm --prefix "$REPO_ROOT" run datasync:sde -- --download --apply
  fi
}

build_market_seed() {
  local mode="$1"

  require_command cargo

  echo "[eve.js] Building market seed ($mode)..."

  if [[ "$mode" == "smoke" ]]; then
    (
      cd "$MARKET_SEED_DIR"
      cargo run --manifest-path Cargo.toml -- --config config/market-seed.local.toml build --force --station-limit 25 --type-limit 250
    )
    return
  fi

  (
    cd "$MARKET_SEED_DIR"
    cargo run --release --manifest-path Cargo.toml -- --config config/market-seed.local.toml build --force --preset jita_new_caldari
  )
}

start_market_daemon() {
  require_command cargo

  if [[ ! -f "$MARKET_DB_PATH" ]]; then
    echo "[eve.js] Market DB not found at $MARKET_DB_PATH" >&2
    echo "[eve.js] Re-run with --market-smoke or --market-jita to build one first." >&2
    exit 1
  fi

  echo "[eve.js] Starting standalone market daemon..."

  (
    cd "$MARKET_SERVER_DIR"
    cargo run --manifest-path Cargo.toml -- --config config/market-server.local.toml serve
  ) &
  market_pid="$!"

  wait_for_market
  echo "[eve.js] Market daemon is healthy on http://127.0.0.1:40110"
}

for arg in "$@"; do
  case "$arg" in
    --market-smoke)
      market_mode="smoke"
      ;;
    --market-jita)
      market_mode="jita"
      ;;
    --patched-client)
      client_handshake_mode="patched"
      ;;
    --stock-client)
      client_handshake_mode="stock"
      ;;
    --remote-gateway)
      proxy_local_intercept="0"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[eve.js] Unknown argument: $arg" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
done

trap cleanup EXIT

require_command node
require_command npm

ensure_gateway_cert
ensure_node_deps_and_data

mkdir -p "$SERVER_DIR/logs/node-reports"
export EVEJS_PROXY_LOCAL_INTERCEPT="$proxy_local_intercept"
export EVEJS_CLIENT_HANDSHAKE_MODE="$client_handshake_mode"
export EVEJS_GATEWAY_CERT_PATH="$GATEWAY_CERT_PATH"
export EVEJS_GATEWAY_KEY_PATH="$GATEWAY_KEY_PATH"
if [[ -z "${EVEJS_PROXY_ALLOWED_HOSTS+x}" && "$HOST_PLATFORM" == "Darwin" ]]; then
  export EVEJS_PROXY_ALLOWED_HOSTS="clientresources.eveonline.com"
fi

if [[ "$market_mode" != "none" ]]; then
  build_market_seed "$market_mode"
  start_market_daemon
fi

print_runtime_summary
echo "[eve.js] Starting main server..."
echo "[eve.js] Press Ctrl+C to stop."
npm --prefix "$SERVER_DIR" start
