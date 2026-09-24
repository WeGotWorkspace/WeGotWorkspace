#!/usr/bin/env bash
# Fresh-artifact install matrix: CHANNEL=zip|docker and DB=sqlite|mariadb.
# The release ZIP must already contain packages/api/vendor. composer install
# runs only when WGW_INSTALL_E2E_DEV_COMPOSER=1 (never set in CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHANNEL="${CHANNEL:-zip}"
DB="${DB:-sqlite}"
PORT="${WGW_E2E_INSTALL_PORT:-18091}"
ADMIN_USER="${WGW_E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${WGW_E2E_ADMIN_PASS:-longpassword99}"
ADMIN_EMAIL="${WGW_E2E_ADMIN_EMAIL:-admin@e2e.test}"
DB_NAME="${WGW_E2E_DB_NAME:-wgw}"
DB_USER="${WGW_E2E_DB_USER:-wgw}"
DB_PASSWORD="${WGW_E2E_DB_PASSWORD:-wgw}"
DB_PORT="${WGW_E2E_DB_PORT:-3306}"
IMAGE="${WGW_INSTALL_E2E_IMAGE:-}"
ZIP="${WGW_INSTALL_E2E_ZIP:-}"
WORK="${WGW_INSTALL_E2E_WORK:-}"
KEEP="${WGW_INSTALL_E2E_KEEP:-0}"

if [[ "$CHANNEL" != "zip" && "$CHANNEL" != "docker" ]]; then
  echo "CHANNEL must be zip or docker" >&2
  exit 2
fi
if [[ "$DB" != "sqlite" && "$DB" != "mariadb" ]]; then
  echo "DB must be sqlite or mariadb" >&2
  exit 2
fi

cleanup() {
  local status=$?
  if [[ "$KEEP" == "1" ]]; then
    return "$status"
  fi
  if [[ -n "${PHP_PID:-}" ]]; then
    kill "$PHP_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${APP_CID:-}" ]]; then
    docker rm -f "$APP_CID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${DB_CID:-}" ]]; then
    docker rm -f "$DB_CID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${DOCKER_NET:-}" ]]; then
    docker network rm "$DOCKER_NET" >/dev/null 2>&1 || true
  fi
  return "$status"
}
trap cleanup EXIT

wait_until() {
  local label="$1"
  local i=0
  while [[ "$i" -lt 45 ]]; do
    if "${@:2}"; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "Timed out after 45 attempts: ${label}" >&2
  return 1
}

require_vendor() {
  local tree="$1"
  if [[ -f "${tree}/packages/api/vendor/autoload.php" ]]; then
    return 0
  fi
  if [[ "${WGW_INSTALL_E2E_DEV_COMPOSER:-}" == "1" ]]; then
    echo "DEV composer install in ${tree}/packages/api"
    composer --working-dir "${tree}/packages/api" install --no-interaction --prefer-dist --no-dev
    return 0
  fi
  echo "Release tree is missing packages/api/vendor. Refusing to composer install." >&2
  echo "Set WGW_INSTALL_E2E_DEV_COMPOSER=1 only for a local tree that is not a release ZIP." >&2
  exit 1
}

resolve_zip() {
  if [[ -n "$ZIP" && -f "$ZIP" ]]; then
    return 0
  fi
  local found
  found="$(find "$ROOT/dist/releases" -maxdepth 1 -name 'wegotworkspace-deploy-*.zip' -print 2>/dev/null | head -1 || true)"
  if [[ -z "$found" ]]; then
    echo "No release ZIP. Set WGW_INSTALL_E2E_ZIP or build dist/releases/wegotworkspace-deploy-*.zip" >&2
    exit 1
  fi
  ZIP="$found"
}

if [[ -z "$WORK" ]]; then
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/wgw-install-e2e.XXXXXX")"
fi
mkdir -p "$WORK"

DB_HOST="127.0.0.1"
if [[ "$DB" == "mariadb" ]]; then
  if [[ "$CHANNEL" == "docker" ]]; then
    DOCKER_NET="wgw-e2e-$$"
    docker network create "$DOCKER_NET" >/dev/null
    DB_HOST="wgw-mariadb"
    DB_CID="$(docker run -d --name "wgw-mariadb-$$" --network "$DOCKER_NET" --network-alias "$DB_HOST" \
      -e MARIADB_ROOT_PASSWORD=root \
      -e MARIADB_DATABASE="$DB_NAME" \
      -e MARIADB_USER="$DB_USER" \
      -e MARIADB_PASSWORD="$DB_PASSWORD" \
      mariadb:11)"
  else
    DB_CID="$(docker run -d --name "wgw-mariadb-$$" -p "127.0.0.1:${DB_PORT}:3306" \
      -e MARIADB_ROOT_PASSWORD=root \
      -e MARIADB_DATABASE="$DB_NAME" \
      -e MARIADB_USER="$DB_USER" \
      -e MARIADB_PASSWORD="$DB_PASSWORD" \
      mariadb:11)"
  fi
  wait_until "MariaDB" docker exec "$DB_CID" mariadb-admin ping -h 127.0.0.1 -uroot -proot --silent
fi

if [[ "$CHANNEL" == "zip" ]]; then
  resolve_zip
  unzip -q "$ZIP" -d "$WORK/tree"
  require_vendor "$WORK/tree"
  export WGW_INSTALL_HEADLESS=0
  export WGW_DISABLE_LOGIN_THROTTLE=1
  unset WGW_INSTALL_DB_DRIVER WGW_INSTALL_DB_HOST WGW_INSTALL_DB_DATABASE || true
  php -S "127.0.0.1:${PORT}" -t "$WORK/tree" "$WORK/tree/index.php" >"$WORK/php.log" 2>&1 &
  PHP_PID=$!
  BASE="http://127.0.0.1:${PORT}"
  wait_until "PHP health" curl -fsS "${BASE}/api/v1/health"
else
  if [[ -z "$IMAGE" ]]; then
    resolve_zip
    mkdir -p "$ROOT/dist/releases"
    cp "$ZIP" "$ROOT/dist/releases/"
    docker build -f "$ROOT/docker/install/Dockerfile.runtime" -t "wgw-install-e2e:local" "$ROOT"
    IMAGE="wgw-install-e2e:local"
  fi
  RUN_ARGS=(docker run -d --name "wgw-app-$$" -p "127.0.0.1:${PORT}:80" -e WGW_INSTALL_HEADLESS=0 -e WGW_DISABLE_LOGIN_THROTTLE=1 -e WGW_WAIT_FOR_DB=0)
  if [[ "$DB" == "mariadb" ]]; then
    RUN_ARGS+=(--network "$DOCKER_NET")
  fi
  RUN_ARGS+=("$IMAGE")
  APP_CID="$("${RUN_ARGS[@]}")"
  BASE="http://127.0.0.1:${PORT}"
  if ! wait_until "container health" curl -fsS "${BASE}/api/v1/health"; then
    docker logs "$APP_CID" >&2 || true
    exit 1
  fi
fi

export WGW_API_E2E_NO_SERVER=1
export WGW_API_BASE_URL="$BASE"
export WGW_INSTALL_BASE_URL="$BASE"
export WGW_E2E_DB="$DB"
export WGW_E2E_DB_HOST="$DB_HOST"
export WGW_E2E_DB_PORT="$DB_PORT"
export WGW_E2E_DB_NAME="$DB_NAME"
export WGW_E2E_DB_USER="$DB_USER"
export WGW_E2E_DB_PASSWORD="$DB_PASSWORD"
export WGW_E2E_ADMIN_USER="$ADMIN_USER"
export WGW_E2E_ADMIN_PASS="$ADMIN_PASS"
export WGW_E2E_ADMIN_EMAIL="$ADMIN_EMAIL"
export CI="${CI:-}"

cd "$ROOT/tools/api-e2e"
pnpm exec playwright test e2e/install.fresh.spec.ts
