#!/usr/bin/env bash
# Install a published baseline image, seed users/calendars/drive/contacts, swap
# the container to the current tree, and check the data over JWT and WebDAV.
# Set WGW_UPGRADE_TO_IMAGE to skip the local current-branch image build
# (the install-e2e upgrade job passes the candidate digest).
#
# Baseline is the manifest-list digest of
# ghcr.io/wegotworkspace/wegotworkspace:0.1.99. Override with
# WGW_UPGRADE_FROM_IMAGE (keep the digest form). Composer and Alpine pins are
# index digests too.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FROM_IMAGE="${WGW_UPGRADE_FROM_IMAGE:-ghcr.io/wegotworkspace/wegotworkspace@sha256:a06f9c66512a737b156bd571905deebe589810c8193ec911c1b28e76cb679fa0}"
COMPOSER_IMAGE="${WGW_UPGRADE_COMPOSER_IMAGE:-composer@sha256:af98f42dfff7c68ba8d53c2164fd9fde1087b7d449514baa38c418b1f6bc4bac}"
ALPINE_IMAGE="${WGW_UPGRADE_ALPINE_IMAGE:-alpine@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6}"
TO_IMAGE="${WGW_UPGRADE_TO_IMAGE:-}"
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
PORT=""

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
    rm -rf "$STAGE" 2>/dev/null || docker run --rm -v "$STAGE:/stage" "$ALPINE_IMAGE" rm -rf /stage || true
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

pick_port() {
  if [[ -n "${WGW_E2E_UPGRADE_PORT:-}" ]]; then
    echo "$WGW_E2E_UPGRADE_PORT"
    return
  fi
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
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
    "$ROOT/docker/install/wgw-install-prepare-dirs.sh" \
    "$STAGE/install/"
  local composer_cache="${WGW_UPGRADE_COMPOSER_CACHE:-${HOME}/.composer/cache}"
  mkdir -p "$composer_cache"
  echo "Installing Composer dependencies for the upgrade image"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -e COMPOSER_HOME=/tmp/composer \
    -e COMPOSER_CACHE_DIR=/tmp/composer-cache \
    -v "${composer_cache}:/tmp/composer-cache" \
    -v "$STAGE/tree/packages/api:/app" \
    -w /app \
    "$COMPOSER_IMAGE" \
    install --no-dev --no-interaction --prefer-dist --no-scripts --ignore-platform-reqs
}

build_current_image() {
  stage_current_tree
  if [[ "${WGW_UPGRADE_DOCKER_CACHE:-}" == "gha" ]]; then
    docker buildx build --load \
      --cache-from type=gha \
      --cache-to type=gha,mode=max \
      -f "$ROOT/docker/install/Dockerfile.upgrade-target" \
      -t "$LOCAL_TAG" \
      "$STAGE"
  else
    docker build -f "$ROOT/docker/install/Dockerfile.upgrade-target" -t "$LOCAL_TAG" "$STAGE"
  fi
  TO_IMAGE="$LOCAL_TAG"
}

# Mount the content and storage volumes at the historical in-tree paths and at
# /var/wgw. The published baseline image writes WGW_DATA_DIR=./wgw-content, and
# this script does not set WGW_DATA_DIR, so an upgraded install keeps reading
# that path until an operator follows the move in INSTALL.md. Fresh installs
# use only /var/wgw via docker-compose.yml.
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
    -v "${VOL_CONTENT}:/var/wgw/content" \
    -v "${VOL_STORAGE}:/var/www/html/packages/api/storage" \
    -v "${VOL_STORAGE}:/var/wgw/storage" \
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
    -v "${VOL_CONTENT}:/var/wgw/content" \
    -v "${VOL_STORAGE}:/var/www/html/packages/api/storage" \
    -v "${VOL_STORAGE}:/var/wgw/storage" \
    -v "${VOL_CONFIG}:/wgw-config-vol" \
    "$image" >/dev/null
}

stop_web() {
  docker rm -f "$WEB_NAME" >/dev/null 2>&1 || true
}

# Hash of the APP_KEY line on the config volume. Prints only the hash, never
# the key. Fails when the key is missing or empty.
app_key_hash() {
  docker run --rm -v "${VOL_CONFIG}:/vol:ro" "$ALPINE_IMAGE" sh -c \
    'grep -Eq "^APP_KEY=.+" /vol/api.env && grep "^APP_KEY=" /vol/api.env | sha256sum | cut -d" " -f1'
}

expect_app_key_hash() {
  local label="$1"
  local expected="$2"
  local actual
  actual="$(app_key_hash)" || {
    echo "APP_KEY missing or empty ${label}" >&2
    exit 1
  }
  if [[ "$actual" != "$expected" ]]; then
    echo "APP_KEY changed ${label} (sha256 ${expected} -> ${actual})" >&2
    exit 1
  fi
  echo "APP_KEY unchanged ${label} (sha256 ${actual})"
}

command -v node >/dev/null
command -v docker >/dev/null
PORT="$(pick_port)"
echo "Upgrade e2e on 127.0.0.1:${PORT}"

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
if ! wait_until "baseline health" curl -fsS "${BASE}/api/v1/health"; then
  docker logs "$WEB_NAME" >&2 || true
  exit 1
fi

export WGW_UPGRADE_BASE_URL="$BASE"
export WGW_UPGRADE_MANIFEST="$MANIFEST"
export WGW_E2E_ADMIN_USER="$ADMIN_USER"
export WGW_E2E_ADMIN_PASS="$ADMIN_PASS"
export WGW_E2E_ADMIN_EMAIL="$ADMIN_EMAIL"
node "$ROOT/tools/upgrade-e2e/integrity.mjs" seed
APP_KEY_HASH="$(app_key_hash)" || {
  echo "APP_KEY missing or empty after baseline install" >&2
  exit 1
}

stop_web
run_migrator "$TO_IMAGE"
start_web "$TO_IMAGE"
if ! wait_until "upgraded health" curl -fsS "${BASE}/api/v1/health"; then
  docker logs "$WEB_NAME" >&2 || true
  exit 1
fi
expect_app_key_hash "after upgrade" "$APP_KEY_HASH"

# A restart must keep APP_KEY. A new key would orphan everything sealed
# under the old one (refresh tokens, share links, collab ticket key).
stop_web
start_web "$TO_IMAGE"
if ! wait_until "restarted health" curl -fsS "${BASE}/api/v1/health"; then
  docker logs "$WEB_NAME" >&2 || true
  exit 1
fi
expect_app_key_hash "after restart" "$APP_KEY_HASH"
node "$ROOT/tools/upgrade-e2e/integrity.mjs" verify
echo "Baseline → current upgrade kept users, calendars, notes, tasks, drive files, and contacts"
