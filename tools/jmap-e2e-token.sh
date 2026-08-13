#!/usr/bin/env bash
# Mint a bearer token for JMAP client e2e runs against a local dev API.
#
# Prints ONLY the access token to stdout so it composes:
#   JMAP_E2E_TOKEN="$(tools/jmap-e2e-token.sh)"
# Diagnostics go to stderr. Defaults match `php artisan wgw:dev-install`
# (admin / storybook-dev) and the `pnpm dev:api` port.
#
# Usage: tools/jmap-e2e-token.sh [--base URL] [--username U] [--password P] [--check]
#   --check  also verify GET /api/v1/jmap/session with the minted token
set -euo pipefail

BASE="${WGW_E2E_BASE:-http://127.0.0.1:9080}"
USERNAME="${WGW_E2E_USERNAME:-admin}"
PASSWORD="${WGW_E2E_PASSWORD:-storybook-dev}"
CHECK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --username) USERNAME="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

BASE="${BASE%/}"

if ! curl -sf -o /dev/null "${BASE}/api/v1/health"; then
  echo "API not reachable at ${BASE} — start it with: pnpm dev:api" >&2
  echo "(first run bootstraps the dev install: admin / storybook-dev)" >&2
  exit 1
fi

RESPONSE="$(curl -s -X POST "${BASE}/api/v1/auth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")"

TOKEN="$(BODY="$RESPONSE" php -r '
    $body = json_decode((string) getenv("BODY"), true);
    echo is_array($body) ? (string) ($body["accessToken"] ?? $body["access_token"] ?? $body["token"] ?? "") : "";
')"

if [[ -z "$TOKEN" ]]; then
  echo "auth/token did not return a token for '${USERNAME}': ${RESPONSE}" >&2
  echo "Reset the dev password with: pnpm setup:storybook-live-api --set-password" >&2
  exit 1
fi

if [[ "$CHECK" -eq 1 ]]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${TOKEN}" "${BASE}/api/v1/jmap/session")"
  if [[ "$CODE" != "200" ]]; then
    echo "GET /api/v1/jmap/session returned HTTP ${CODE} with the minted token." >&2
    exit 1
  fi
  echo "JMAP session check OK (${BASE}/api/v1/jmap/session)." >&2
fi

echo "$TOKEN"
