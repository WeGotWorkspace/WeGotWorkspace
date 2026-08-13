#!/usr/bin/env bash
# One-command live e2e: the vendored jmap-client (packages/apps/src/lib/jmap-client,
# vendored verbatim from lit-calendar) against this backend's JMAP envelope.
# See packages/api/docs/calendars/jmap-client-e2e.md.
#
#   pnpm test:jmap-client-e2e
#
# What it does:
#   1. Starts a local API on :9080 if none is reachable (dev install bootstrap),
#      and stops it again on exit. A running `pnpm dev:api` is reused as-is.
#   2. Mints a bearer via tools/jmap-e2e-token.sh.
#   3. Runs the gated suite src/lib/jmap-client/tests/wgw-backend.e2e.test.ts
#      with the apps vitest setup.
#
# Env overrides: WGW_E2E_BASE, WGW_E2E_USERNAME, WGW_E2E_PASSWORD.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${WGW_E2E_BASE:-http://127.0.0.1:9080}"

API_PID=""
cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. Backend API — reuse a running one, otherwise start and own one.
if ! curl -sf -o /dev/null "$BASE/api/v1/health"; then
  if [[ "$BASE" != "http://127.0.0.1:9080" ]]; then
    echo "API not reachable at $BASE and autostart only applies to the default local base." >&2
    exit 1
  fi
  echo "No API on :9080 — starting one (dev install bootstrap) …" >&2
  (cd "$ROOT" && php packages/api/artisan wgw:dev-install) >&2
  (cd "$ROOT/packages/api" && sh -c 'app_root="../../apps/wegotworkspace"; exec env -u SABRE_BUILD_DIR php -S 127.0.0.1:9080 -t "$app_root" "$app_root/index.php"') >/dev/null 2>&1 &
  API_PID=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "$BASE/api/v1/health" && break
    sleep 0.5
  done
  if ! curl -sf -o /dev/null "$BASE/api/v1/health"; then
    echo "API failed to come up on :9080." >&2
    exit 1
  fi
fi

# 2. Token.
TOKEN="$(WGW_E2E_BASE="$BASE" "$ROOT/tools/jmap-e2e-token.sh" --check)"

# 3. Run the gated suite with the vendored client.
echo "Running the vendored jmap-client against $BASE …" >&2
(
  cd "$ROOT/packages/apps" \
    && JMAP_E2E_URL="$BASE" JMAP_E2E_TOKEN="$TOKEN" \
      pnpm exec vitest run --project unit src/lib/jmap-client/tests/wgw-backend.e2e.test.ts
)
