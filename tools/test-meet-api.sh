#!/usr/bin/env bash
# Smoke-test Meet signaling on /api/v1/rooms/* against the local install.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_LOCAL="$ROOT/.env.local"

PROXY_TARGET="${WGW_PROXY_TARGET:-https://wegotworkspace.localhost}"
ROOM="${MEET_SIGNAL_ROOM:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      PROXY_TARGET="$2"
      shift 2
      ;;
    --room)
      ROOM="$2"
      shift 2
      ;;
    -h | --help)
      echo "Usage: tools/test-meet-api.sh [--base URL] [--room CODE]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -f "$ENV_LOCAL" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] || continue
    case "$line" in
      WGW_PROXY_TARGET=*|MEET_*=*)
        export "$line"
        ;;
    esac
  done <"$ENV_LOCAL"
fi

PROXY_TARGET="${WGW_PROXY_TARGET:-$PROXY_TARGET}"
if [[ -z "$ROOM" ]]; then
  ROOM="$(python3 - <<'PY'
import random
alphabet = "abcdefghjklmnpqrstuvwxyz23456789"
block = lambda: "".join(random.choice(alphabet) for _ in range(4))
print(f"{block()}-{block()}-{block()}")
PY
)"
fi

BASE="${PROXY_TARGET%/}/api/v1"
PEER="guestpeer1"
CURL=(curl -sS)
if [[ "$BASE" == https://* ]]; then
  CURL+=(-k)
fi

check_http() {
  local code="$1"
  local expect="$2"
  local label="$3"
  if [[ "$code" != "$expect" ]]; then
    echo "FAIL: $label (expected HTTP $expect, got $code)" >&2
    exit 1
  fi
}

echo "==> Config"
echo "  BASE=$BASE"
echo "  ROOM=$ROOM"

echo ""
echo "==> Health"
HEALTH_BODY="$("${CURL[@]}" -w '\n%{http_code}' "$BASE/health")"
HEALTH_CODE="${HEALTH_BODY##*$'\n'}"
HEALTH_JSON="${HEALTH_BODY%$'\n'*}"
check_http "$HEALTH_CODE" "200" "GET /health"
echo "$HEALTH_JSON" | python3 -m json.tool

echo ""
echo "==> Guest join"
JOIN_RESPONSE="$("${CURL[@]}" -w '\n%{http_code}' -X POST "$BASE/rooms/${ROOM}/participants" \
  -H 'Content-Type: application/json' \
  -d "{\"peerId\":\"${PEER}\",\"name\":\"Guest One\"}")"
JOIN_CODE="${JOIN_RESPONSE##*$'\n'}"
JOIN_JSON="${JOIN_RESPONSE%$'\n'*}"
check_http "$JOIN_CODE" "200" "POST /rooms/{room}/participants"
echo "$JOIN_JSON" | python3 -m json.tool
SESSION_KEY="$(printf '%s' "$JOIN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("sessionKey") or "")')"
if [[ -z "$SESSION_KEY" ]]; then
  echo "FAIL: guest join did not return sessionKey" >&2
  exit 1
fi

echo ""
echo "==> Guest poll"
POLL_RESPONSE="$("${CURL[@]}" -w '\n%{http_code}' \
  "$BASE/rooms/${ROOM}/events?peerId=${PEER}&since=0&sessionKey=${SESSION_KEY}")"
POLL_CODE="${POLL_RESPONSE##*$'\n'}"
POLL_JSON="${POLL_RESPONSE%$'\n'*}"
check_http "$POLL_CODE" "200" "GET /rooms/{room}/events"
echo "$POLL_JSON" | python3 -m json.tool

echo ""
echo "==> Guest leave"
# destroyParticipant reads sessionKey from the JSON body. The query is kept
# beside it so the URL matches the rooms contract used by the poll.
LEAVE_RESPONSE="$("${CURL[@]}" -w '\n%{http_code}' -X DELETE \
  "$BASE/rooms/${ROOM}/participants/${PEER}?sessionKey=${SESSION_KEY}" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionKey\":\"${SESSION_KEY}\"}")"
LEAVE_CODE="${LEAVE_RESPONSE##*$'\n'}"
LEAVE_JSON="${LEAVE_RESPONSE%$'\n'*}"
check_http "$LEAVE_CODE" "200" "DELETE /rooms/{room}/participants/{peerId}"
echo "$LEAVE_JSON" | python3 -m json.tool

echo ""
echo "==> Done — Meet signaling checks passed"
