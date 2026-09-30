#!/usr/bin/env bash
# Install ghcr.io/...:0.1.99, seed users/calendars/drive/contacts, swap the
# container to the current tree, and check the data over JWT and WebDAV.
# Set WGW_UPGRADE_TO_IMAGE to skip the local current-branch image build
# (the install-e2e matrix passes the candidate digest).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FROM_IMAGE="${WGW_UPGRADE_FROM_IMAGE:-ghcr.io/wegotworkspace/wegotworkspace:0.1.99}"
TO_IMAGE="${WGW_UPGRADE_TO_IMAGE:-}"
PORT="${WGW_E2E_UPGRADE_PORT:-18092}"
ADMIN_USER="${WGW_E2E_ADMIN_USER:-admin}"
ADMIN_PASS="${WGW_E2E_ADMIN_PASS:-longpassword99}"
ADMIN_EMAIL="${WGW_E2E_ADMIN_EMAIL:-admin@e2e.test}"
KEEP="${WGW_INSTALL_E2E_KEEP:-0}"
LOCAL_TAG="wgw-upgrade-target:local"
SUFFIX="$$"
VOL_CONTENT="wgw-upgrade-content-${SUFFIX}"
VOL_STORAGE="wgw-upgrade-storage-${SUFFIX}"
VOL_CONFIG="wgw-upgrade-config-${SUFFIX}"
WEB_NAME="wgw-upgrade-web-${SUFFIX}"
STAGE=""
WORK=""

cleanup() {
  local status=$?
  if [[ "$KEEP" == "1" ]]; then
    echo "Keeping upgrade containers and volumes (WGW_INSTALL_E2E_KEEP=1)" >&2
    return "$status"
  fi
  if docker inspect "$WEB_NAME" >/dev/null 2>&1; then
    if [[ "$status" -ne 0 ]]; then
      echo "---- ${WEB_NAME} logs ----" >&2
      docker logs "$WEB_NAME" >&2 || true
    fi
    docker rm -f "$WEB_NAME" >/dev/null 2>&1 || true
  fi
  docker volume rm "$VOL_CONTENT" "$VOL_STORAGE" "$VOL_CONFIG" >/dev/null 2>&1 || true
  if [[ -n "$STAGE" && -d "$STAGE" ]]; then
    rm -rf "$STAGE" 2>/dev/null || docker run --rm -v "$STAGE:/stage" alpine:3 rm -rf /stage || true
  fi
  if [[ -n "$WORK" && -d "$WORK" ]]; then
    rm -rf "$WORK" 2>/dev/null || true
  fi
  return "$status"
}
trap cleanup EXIT

wait_until() {
  local label="$1"
  local i=0
  while [[ "$i" -lt 60 ]]; do
    if "${@:2}"; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "Timed out after 60 attempts: ${label}" >&2
  return 1
}

stage_current_tree() {
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/wgw-upgrade-e2e.XXXXXX")"
  mkdir -p "$STAGE/tree/bootstrap" "$STAGE/tree/packages" "$STAGE/install"
  cp "$ROOT/apps/wegotworkspace/index.php" \
    "$ROOT/apps/wegotworkspace/.htaccess" \
    "$ROOT/apps/wegotworkspace/.user.ini" \
    "$ROOT/apps/wegotworkspace/wgw-config.sample.php" \
    "$STAGE/tree/"
  cp -a "$ROOT/apps/wegotworkspace/bootstrap/." "$STAGE/tree/bootstrap/"
  tar -C "$ROOT/packages" \
    --exclude api/vendor \
    --exclude api/node_modules \
    --exclude api/.env \
    --exclude api/tests \
    --exclude api/storage \
    --exclude 'api/bootstrap/cache/*.php' \
    -cf - api | tar -C "$STAGE/tree/packages" -xf -
  cp "$ROOT/docker/php/uploads.ini" "$STAGE/install/uploads.ini"
  cp "$ROOT/docker/install/vhost.conf" \
    "$ROOT/docker/install/http-vhost.conf" \
    "$ROOT/docker/install/docker-entrypoint.sh" \
    "$ROOT/docker/install/wgw-install-wait-db.sh" \
    "$ROOT/docker/install/wgw-install-migrate.sh" \
    "$ROOT/docker/install/wgw-install-seed-config.sh" \
    "$STAGE/install/"
  echo "Installing Composer dependencies for the upgrade image"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e COMPOSER_HOME=/tmp/composer \
    -v "$STAGE/tree/packages/api:/app" \
    -w /app \
    composer:2 \
    install --no-dev --no-interaction --prefer-dist --no-scripts --ignore-platform-reqs
}

build_current_image() {
  stage_current_tree
  local build=(docker build -f "$ROOT/docker/install/Dockerfile.upgrade-target" -t "$LOCAL_TAG")
  if [[ "${WGW_UPGRADE_DOCKER_CACHE:-}" == "gha" ]]; then
    build+=(--cache-from type=gha --cache-to type=gha,mode=max)
  fi
  build+=("$STAGE")
  "${build[@]}"
  TO_IMAGE="$LOCAL_TAG"
}

run_migrator() {
  local image="$1"
  echo "=== migrator ${image} ==="
  docker run --rm \
    --entrypoint /bin/sh \
    -e WGW_APP_ROOT=/var/www/html \
    -e WGW_INSTALL_HEADLESS=1 \
    -e WGW_WAIT_FOR_DB=0 \
    -e WGW_INSTALL_BASE_URI=/ \
    -e WGW_INSTALL_ADMIN_USERNAME="$ADMIN_USER" \
    -e WGW_INSTALL_ADMIN_EMAIL="$ADMIN_EMAIL" \
    -e WGW_INSTALL_ADMIN_PASSWORD="$ADMIN_PASS" \
    -e WGW_DISABLE_LOGIN_THROTTLE=1 \
    -v "${VOL_CONTENT}:/var/www/html/wgw-content" \
    -v "${VOL_STORAGE}:/var/www/html/packages/api/storage" \
    -v "${VOL_CONFIG}:/wgw-config-vol" \
    "$image" -c '
      set -eu
      /usr/local/bin/wgw-install-seed-config.sh
      ln -sfn /wgw-config-vol/api.env /var/www/html/packages/api/.env
      /usr/local/bin/wgw-install-migrate.sh
      test -f /var/www/html/wgw-content/.installed
    '
}

start_web() {
  local image="$1"
  docker rm -f "$WEB_NAME" >/dev/null 2>&1 || true
  docker run -d --name "$WEB_NAME" \
    -p "127.0.0.1:${PORT}:80" \
    -e WGW_APP_ROOT=/var/www/html \
    -e WGW_WAIT_FOR_DB=0 \
    -e WGW_INSTALL_HEADLESS=0 \
    -e WGW_DISABLE_LOGIN_THROTTLE=1 \
    -v "${VOL_CONTENT}:/var/www/html/wgw-content" \
    -v "${VOL_STORAGE}:/var/www/html/packages/api/storage" \
    -v "${VOL_CONFIG}:/wgw-config-vol" \
    "$image" >/dev/null
}

stop_web() {
  docker rm -f "$WEB_NAME" >/dev/null 2>&1 || true
}

command -v node >/dev/null
command -v docker >/dev/null

echo "Pulling ${FROM_IMAGE}"
docker pull "$FROM_IMAGE"
if [[ -z "$TO_IMAGE" ]]; then
  build_current_image
elif [[ "$TO_IMAGE" == */* ]]; then
  echo "Pulling ${TO_IMAGE}"
  docker pull "$TO_IMAGE"
fi

docker volume create "$VOL_CONTENT" >/dev/null
docker volume create "$VOL_STORAGE" >/dev/null
docker volume create "$VOL_CONFIG" >/dev/null

WORK="$(mktemp -d "${TMPDIR:-/tmp}/wgw-upgrade-work.XXXXXX")"
MANIFEST="$WORK/manifest.json"

run_migrator "$FROM_IMAGE"
start_web "$FROM_IMAGE"
BASE="http://127.0.0.1:${PORT}"
if ! wait_until "v0.1.99 health" curl -fsS "${BASE}/api/v1/health"; then
  docker logs "$WEB_NAME" >&2 || true
  exit 1
fi

export WGW_UPGRADE_BASE_URL="$BASE"
export WGW_UPGRADE_MANIFEST="$MANIFEST"
export WGW_E2E_ADMIN_USER="$ADMIN_USER"
export WGW_E2E_ADMIN_PASS="$ADMIN_PASS"
export WGW_E2E_ADMIN_EMAIL="$ADMIN_EMAIL"
node "$ROOT/tools/upgrade-e2e/integrity.mjs" seed

stop_web
run_migrator "$TO_IMAGE"
start_web "$TO_IMAGE"
if ! wait_until "upgraded health" curl -fsS "${BASE}/api/v1/health"; then
  docker logs "$WEB_NAME" >&2 || true
  exit 1
fi
node "$ROOT/tools/upgrade-e2e/integrity.mjs" verify
echo "v0.1.99 → current upgrade kept users, calendars, drive files, and contacts"
