#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${WGW_DOCKER_HTTP_PORT:-9080}"
BASE="http://127.0.0.1:${PORT}"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [ ! -f packages/api/vendor/autoload.php ]; then
  echo "==> Installing Composer dependencies"
  composer --working-dir packages/api install --no-interaction --prefer-dist
fi

INSTALL_ROOT="${ROOT}/apps/wegotworkspace"
INSTALL_DIST="${INSTALL_ROOT}/packages/apps/install/dist/index.html"
if [ ! -f "${INSTALL_DIST}" ]; then
  echo "==> Building UI dist (installer + runtime module shells)"
  pnpm --filter @wgw/apps run build:dev
  pnpm --filter @wgw/apps run sync:runtime
fi

STASH_DIR=""
stash_install_state() {
  if [ -f "${INSTALL_ROOT}/wgw-config.php" ] || [ -e "${INSTALL_ROOT}/wgw-content" ]; then
    STASH_DIR="$(mktemp -d)"
    echo "==> Stashing local install tree for installer e2e (${STASH_DIR})"
    for name in wgw-config.php wgw-content; do
      if [ -e "${INSTALL_ROOT}/${name}" ]; then
        mv "${INSTALL_ROOT}/${name}" "${STASH_DIR}/"
      fi
    done
  fi
  mkdir -p "${INSTALL_ROOT}/wgw-content"
}

restore_install_state() {
  if [ -z "${STASH_DIR}" ] || [ ! -d "${STASH_DIR}" ]; then
    return 0
  fi
  echo "==> Restoring local install tree"
  rm -rf "${INSTALL_ROOT}/wgw-content"
  for name in wgw-content wgw-config.php; do
    if [ -e "${STASH_DIR}/${name}" ]; then
      mv "${STASH_DIR}/${name}" "${INSTALL_ROOT}/"
    fi
  done
  rmdir "${STASH_DIR}" 2>/dev/null || true
}

COMPOSE_FILES=(-f compose.ci.yml)

cleanup() {
  docker compose "${COMPOSE_FILES[@]}" down -v 2>/dev/null || true
}
trap 'restore_install_state; cleanup' EXIT

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: port ${PORT} is already in use (often wgw-dev-web-1 from pnpm docker:up)." >&2
  echo "Stop it with: docker compose -f compose.dev.yml down" >&2
  echo "Or run on another port: WGW_DOCKER_HTTP_PORT=9081 pnpm test:api-e2e:docker" >&2
  exit 1
fi

stash_install_state

echo "==> Starting Docker stack (compose.ci.yml)"
docker compose "${COMPOSE_FILES[@]}" up -d --build --wait

export WGW_API_E2E_NO_SERVER=1
export WGW_API_BASE_URL="${BASE}"
export WGW_INSTALL_BASE_URL="${BASE}"

echo "==> Installing Playwright browser (Chromium)"
pnpm --filter @wgw/api-e2e exec playwright install --with-deps chromium

echo "==> Playwright API e2e against ${BASE}"
pnpm --filter @wgw/api-e2e test
