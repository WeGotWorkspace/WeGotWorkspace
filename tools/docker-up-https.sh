#!/usr/bin/env bash
# Bring up the local HTTPS stack. Leaf certs are gitignored, so
# `docker compose ... compose.local.yml` alone publishes :443 with no TLS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOMAIN="${WGW_DEV_DOMAIN:-wegotworkspace.localhost}"
CERT_PEM="${ROOT}/docker/apache/certs/${DOMAIN}.pem"
CERT_KEY="${ROOT}/docker/apache/certs/${DOMAIN}-key.pem"

if [ ! -s "${CERT_PEM}" ] || [ ! -s "${CERT_KEY}" ]; then
  echo "==> HTTPS certs missing under docker/apache/certs/; running pnpm docker:ssl:setup"
  pnpm docker:ssl:setup
fi

if [ ! -s "${CERT_PEM}" ] || [ ! -s "${CERT_KEY}" ]; then
  echo "HTTPS certs were not created. Install mkcert, then: brew install mkcert && pnpm docker:ssl:setup" >&2
  exit 1
fi

# Recreate so the entrypoint re-reads certs (it chooses HTTP vs HTTPS at boot).
docker compose -f compose.dev.yml -f compose.local.yml up -d --build --force-recreate --wait web
