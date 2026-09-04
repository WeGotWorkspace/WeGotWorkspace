#!/usr/bin/env bash
# Agent handoff: run after a code iteration on feat/rtc-connection-optimization
# before asking the user to test on https://wegotworkspace.localhost (avoids stale RTC peers).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose -f compose.dev.yml -f compose.local.yml)
DOMAIN="${WGW_DEV_DOMAIN:-wegotworkspace.localhost}"
HTTPS_URL="https://${DOMAIN}"

if [ ! -f "docker/apache/certs/${DOMAIN}.pem" ]; then
  echo "==> HTTPS certs missing; running pnpm docker:ssl:setup"
  pnpm docker:ssl:setup
fi

echo "==> Building apps (dev) + syncing to install tree"
pnpm --filter @wgw/apps run build:dev
pnpm --filter @wgw/apps run sync:runtime

echo "==> Syncing API package to install tree"
pnpm --filter @wgw/api run sync:runtime

echo "==> Recreating Docker HTTPS stack (clean session)"
"${COMPOSE[@]}" down
"${COMPOSE[@]}" up -d --build --force-recreate --wait

echo "==> Verifying ${HTTPS_URL}"
curl -fsSk "${HTTPS_URL}/api/v1/health" | grep -q '"status":"ok"'
curl -fsSk "${HTTPS_URL}/" | grep -qv 'api_unavailable'

echo "OK: ${HTTPS_URL} is ready for testing"
