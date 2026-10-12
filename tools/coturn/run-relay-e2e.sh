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

# Playwright starts this API itself so the short TURN TTL is on the process.
# A leftover listener would be reused and refresh would wait out a 3600s TTL.
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -nP -iTCP:9080 -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if ! lsof -nP -iTCP:9080 -sTCP:LISTEN -t >/dev/null 2>&1; then
        break
      fi
      sleep 0.2
    done
  fi
fi

cd "$ROOT/packages/apps"
set +e
pnpm exec playwright test --config playwright.relay.config.mjs
status=$?
set -e
if [[ "$status" -ne 0 ]]; then
  docker logs wgw-coturn >"$ROOT/coturn.log" 2>&1 || true
fi
exit "$status"
