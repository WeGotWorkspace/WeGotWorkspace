#!/usr/bin/env bash
# One-command live e2e: the UNMODIFIED @lit-calendar/jmap-client against this
# backend's JMAP envelope. See packages/api/docs/calendars/jmap-client-e2e.md.
#
#   pnpm test:jmap-client-e2e
#
# What it does:
#   1. Locates the client repo — $LIT_CALENDAR_DIR if set (e.g. your working
#      copy), otherwise clones/updates the public repo into .cache/lit-calendar.
#   2. Starts a local API on :9080 if none is reachable (dev install bootstrap),
#      and stops it again on exit. A running `pnpm dev:api` is reused as-is.
#   3. Mints a bearer via tools/jmap-e2e-token.sh.
#   4. Copies tools/jmap-client-e2e/wgw-backend.e2e.test.ts into the client's
#      src/tests/, runs it with vitest, and removes the copy afterwards.
#
# Env overrides: LIT_CALENDAR_DIR, WGW_E2E_BASE, WGW_E2E_USERNAME, WGW_E2E_PASSWORD.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${WGW_E2E_BASE:-http://127.0.0.1:9080}"
CLIENT_REPO_URL="${LIT_CALENDAR_REPO:-https://github.com/woutervroege/lit-calendar.git}"
CLIENT_DIR="${LIT_CALENDAR_DIR:-$ROOT/.cache/lit-calendar}"
TEST_SOURCE="$ROOT/tools/jmap-client-e2e/wgw-backend.e2e.test.ts"

API_PID=""
TEST_COPY=""
cleanup() {
  [[ -n "$TEST_COPY" && -f "$TEST_COPY" ]] && rm -f "$TEST_COPY"
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# 1. Client repo.
if [[ ! -d "$CLIENT_DIR/packages/jmap-client" ]]; then
  if [[ -n "${LIT_CALENDAR_DIR:-}" ]]; then
    echo "LIT_CALENDAR_DIR=$LIT_CALENDAR_DIR has no packages/jmap-client — wrong directory?" >&2
    exit 1
  fi
  echo "Cloning $CLIENT_REPO_URL into $CLIENT_DIR …" >&2
  git clone --depth 1 "$CLIENT_REPO_URL" "$CLIENT_DIR" >&2
elif [[ -z "${LIT_CALENDAR_DIR:-}" ]]; then
  git -C "$CLIENT_DIR" pull --ff-only >&2 || echo "(client repo update failed — using existing checkout)" >&2
fi

if [[ ! -d "$CLIENT_DIR/packages/jmap-client/node_modules" ]]; then
  echo "Installing client dependencies …" >&2
  (cd "$CLIENT_DIR" && pnpm install --silent) >&2
fi

# 2. Backend API — reuse a running one, otherwise start and own one.
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

# 3. Token.
TOKEN="$(WGW_E2E_BASE="$BASE" "$ROOT/tools/jmap-e2e-token.sh" --check)"

# 4. Inject the test and run it with the client's own vitest.
TEST_COPY="$CLIENT_DIR/packages/jmap-client/src/tests/wgw-backend.e2e.test.ts"
cp "$TEST_SOURCE" "$TEST_COPY"

echo "Running the unmodified @lit-calendar/jmap-client against $BASE …" >&2
(
  cd "$CLIENT_DIR/packages/jmap-client" \
    && JMAP_E2E_URL="$BASE" JMAP_E2E_TOKEN="$TOKEN" pnpm exec vitest run wgw-backend.e2e
)
