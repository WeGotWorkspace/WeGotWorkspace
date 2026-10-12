#!/usr/bin/env bash
# Start a local coturn for the relay Playwright tier.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRET="${WGW_TURN_SECRET:-devsecret}"
NAME="wgw-coturn"
IMAGE="coturn/coturn"

docker rm -f "$NAME" >/dev/null 2>&1 || true

nc_open() {
  local host="$1"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    nc -z -G 1 "$host" 3478
  else
    nc -z -w 1 "$host" 3478
  fi
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
  if [[ -z "$LAN_IP" ]]; then
    IFACE="$(route -n get default | awk '/interface:/{print $2; exit}')"
    LAN_IP="$(ipconfig getifaddr "$IFACE")"
  fi
  if [[ -z "$LAN_IP" ]]; then
    echo "Could not resolve a LAN address for coturn." >&2
    exit 1
  fi
  docker run -d --name "$NAME" \
    -p 3478:3478 \
    -p 3478:3478/udp \
    -p 49160-49200:49160-49200/udp \
    "$IMAGE" \
    -n --log-file=stdout \
    --use-auth-secret \
    --static-auth-secret="$SECRET" \
    --realm=wegotworkspace.localhost \
    --listening-port=3478 \
    --external-ip="$LAN_IP" \
    --min-port=49160 \
    --max-port=49200 \
    --fingerprint \
    --no-cli \
    --no-tls
  TURN_HOST="$LAN_IP"
else
  docker run -d --name "$NAME" --network=host \
    "$IMAGE" \
    -n --log-file=stdout \
    --use-auth-secret \
    --static-auth-secret="$SECRET" \
    --realm=wegotworkspace.localhost \
    --listening-port=3478 \
    --listening-ip=127.0.0.1 \
    --relay-ip=127.0.0.1 \
    --min-port=49160 \
    --max-port=49200 \
    --allow-loopback-peers \
    --fingerprint \
    --no-cli \
    --no-tls
  TURN_HOST="127.0.0.1"
fi

echo "TURN_HOST=$TURN_HOST"

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if nc_open "$TURN_HOST"; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" != 1 ]]; then
  echo "coturn did not accept TCP on ${TURN_HOST}:3478 within 10s" >&2
  docker logs "$NAME" >&2 || true
  exit 1
fi

printf 'TURN_HOST=%s\n' "$TURN_HOST" >"$ROOT/.coturn.env"
