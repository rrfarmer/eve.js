#!/usr/bin/env bash

set -euo pipefail

CA_CERT=""
CA_KEY=""
OUT_CERT=""
OUT_KEY=""

usage() {
  cat <<'EOF'
Usage: bash tools/macos/build-gateway-cert.sh \
  --ca-cert <path> \
  --ca-key <path> \
  --out-cert <path> \
  --out-key <path>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ca-cert)
      CA_CERT="$2"
      shift 2
      ;;
    --ca-key)
      CA_KEY="$2"
      shift 2
      ;;
    --out-cert)
      OUT_CERT="$2"
      shift 2
      ;;
    --out-key)
      OUT_KEY="$2"
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

if [[ -z "$CA_CERT" || -z "$CA_KEY" || -z "$OUT_CERT" || -z "$OUT_KEY" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$CA_CERT" ]]; then
  echo "[eve.js] Missing CA cert: $CA_CERT" >&2
  exit 1
fi

if [[ ! -f "$CA_KEY" ]]; then
  echo "[eve.js] Missing CA key: $CA_KEY" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "[eve.js] Missing required command: openssl" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_CERT")" "$(dirname "$OUT_KEY")"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

csr_path="$tmp_dir/gateway-dev.csr"
leaf_cert_path="$tmp_dir/gateway-dev-leaf.pem"
serial_path="$tmp_dir/gateway-dev.srl"
config_path="$tmp_dir/gateway-dev-openssl.cnf"

cat >"$config_path" <<'EOF'
[req]
distinguished_name = dn
prompt = no
req_extensions = req_ext

[dn]
CN = live-public-gateway.evetech.net

[req_ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = dev-public-gateway.evetech.net
DNS.2 = live-public-gateway.evetech.net
DNS.3 = public-gateway.evetech.net
DNS.4 = localhost
IP.1 = 127.0.0.1
EOF

openssl genrsa -out "$OUT_KEY" 2048 >/dev/null 2>&1
openssl req -new -key "$OUT_KEY" -out "$csr_path" -config "$config_path" >/dev/null 2>&1
openssl x509 \
  -req \
  -in "$csr_path" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -CAserial "$serial_path" \
  -out "$leaf_cert_path" \
  -days 3650 \
  -sha256 \
  -extfile "$config_path" \
  -extensions req_ext >/dev/null 2>&1

cat "$leaf_cert_path" "$CA_CERT" >"$OUT_CERT"
