#!/usr/bin/env bash
# Bring coturn up, run the relay Playwright tier, then always tear coturn down.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export WGW_TURN_SECRET="${WGW_TURN_SECRET:-devsecret}"
export WGW_VITE_DEV_PORT="${WGW_VITE_DEV_PORT:-5391}"
export WGW_APPS_E2E_BASE_URL="${WGW_APPS_E2E_BASE_URL:-http://127.0.0.1:${WGW_VITE_DEV_PORT}}"

cleanup() {
  bash "$ROOT/tools/coturn/down.sh" || true
}
trap cleanup EXIT

bash "$ROOT/tools/coturn/up.sh"
set -a
# shellcheck disable=SC1091
source "$ROOT/.coturn.env"
set +a
export WGW_TURN_HOST="${WGW_TURN_HOST:-$TURN_HOST}"

cd "$ROOT/packages/apps"
set +e
pnpm exec playwright test --config playwright.relay.config.mjs
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  docker logs wgw-coturn >"$ROOT/coturn.log" 2>&1 || true
fi
exit "$status"
