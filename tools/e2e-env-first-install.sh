#!/usr/bin/env bash
# E2E: env-first install + legacy wgw-config migration (ZIP extract and Docker local build).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ZIP_VERSION="${WGW_E2E_ZIP_VERSION:-0.1.70-e2e}"
DOCKER_PORT="${WGW_E2E_DOCKER_PORT:-8090}"
DOCKER_PROJECT="${WGW_E2E_DOCKER_PROJECT:-wgw-e2e-envfirst}"
ZIP_DIR="${WGW_E2E_ZIP_DIR:-/tmp/wgw-e2e-zip-${ZIP_VERSION}}"
DOCKER_ENV="${WGW_E2E_DOCKER_ENV:-/tmp/wgw-e2e-docker-${DOCKER_PROJECT}.env}"
ADMIN_USER=admin
ADMIN_PASS='longpassword99'
ADMIN_EMAIL='admin@e2e.test'

pass() { printf '✅ %s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

wait_health() {
  local base=$1
  local i=0
  while [ "$i" -lt 60 ]; do
    if curl -fsS "${base}/api/v1/health" 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

auth_token() {
  local base=$1
  curl -fsS -X POST "${base}/api/v1/auth/token" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
    | grep -q "\"username\":\"${ADMIN_USER}\""
}

run_zip_e2e() {
  info "ZIP route: fresh install from dist/releases/wegotworkspace-deploy-${ZIP_VERSION}.zip"
  local zip="${ROOT}/dist/releases/wegotworkspace-deploy-${ZIP_VERSION}.zip"
  [ -f "$zip" ] || fail "Missing release zip: $zip"

  rm -rf "$ZIP_DIR"
  mkdir -p "$ZIP_DIR"
  unzip -q "$zip" -d "$ZIP_DIR"

  export WGW_APP_ROOT="$ZIP_DIR"
  export WGW_DISABLE_INSTALL_THROTTLE=1
  export WGW_DISABLE_LOGIN_THROTTLE=1
  export WGW_INSTALL_HEADLESS=1
  export WGW_INSTALL_DB_DRIVER=sqlite
  export WGW_INSTALL_BASE_URI=/
  export WGW_INSTALL_ADMIN_USERNAME="$ADMIN_USER"
  export WGW_INSTALL_ADMIN_EMAIL="$ADMIN_EMAIL"
  export WGW_INSTALL_ADMIN_PASSWORD="$ADMIN_PASS"

  local api="${ZIP_DIR}/packages/api"
  if [ ! -f "${api}/vendor/autoload.php" ]; then
    info "ZIP route: composer install in packages/api"
    composer --working-dir "$api" install --no-interaction --prefer-dist --no-dev
  fi
  if [ ! -f "${api}/.env" ]; then
    cp "${api}/.env.example" "${api}/.env"
    php "${api}/artisan" key:generate --force --no-interaction
  fi

  info "ZIP route: headless wgw:install"
  (cd "$api" && php artisan wgw:config-migrate --no-interaction 2>/dev/null || true)
  (cd "$api" && php artisan wgw:install --no-interaction)

  [ -f "${ZIP_DIR}/wgw-content/.installed" ] || fail "ZIP: .installed lock missing"
  [ ! -f "${ZIP_DIR}/wgw-config.php" ] || fail "ZIP: wgw-config.php should not exist after fresh install"
  grep -q 'WGW_DB_CONNECTION=sqlite' "${api}/.env" || fail "ZIP: WGW_DB_CONNECTION missing from .env"
  pass "ZIP fresh install wrote WGW_* to packages/api/.env"

  info "ZIP route: start PHP server on :8091"
  local zip_port=8091
  php -d post_max_size=32M -d upload_max_filesize=32M -S "127.0.0.1:${zip_port}" -t "$ZIP_DIR" "$ZIP_DIR/index.php" >/tmp/wgw-e2e-zip-php.log 2>&1 &
  local zip_pid=$!
  trap 'kill "$zip_pid" 2>/dev/null || true' RETURN
  sleep 1
  wait_health "http://127.0.0.1:${zip_port}" || fail "ZIP: health check failed"
  auth_token "http://127.0.0.1:${zip_port}" || fail "ZIP: auth after fresh install failed"
  pass "ZIP fresh install: health + login OK"

  info "ZIP route: simulate legacy upgrade (wgw-config.php → .env migrator)"
  cat >"${ZIP_DIR}/wgw-config.php" <<'PHP'
<?php
declare(strict_types=1);
return [
    'data_dir' => './wgw-content',
    'pdo' => ['sqlite_file' => './wgw-content/db.sqlite'],
];
PHP
  # Strip runtime WGW_DB keys to mimic pre-migration .env
  sed -i.bak '/^WGW_DB_/d;/^WGW_DATA_DIR=/d' "${api}/.env"

  (cd "$api" && php artisan config:clear --no-interaction && php artisan wgw:config-migrate --no-interaction)
  [ ! -f "${ZIP_DIR}/wgw-config.php" ] || fail "ZIP upgrade: wgw-config.php should be removed"
  grep -q 'WGW_DB_CONNECTION=sqlite' "${api}/.env" || fail "ZIP upgrade: migrator did not restore WGW_DB_*"
  auth_token "http://127.0.0.1:${zip_port}" || fail "ZIP: auth after legacy migration failed"
  pass "ZIP legacy migration: wgw-config.php → .env, login still works"

  kill "$zip_pid" 2>/dev/null || true
  trap - RETURN
}

run_docker_e2e() {
  info "Docker route: local build on port ${DOCKER_PORT} (project ${DOCKER_PROJECT})"
  cat >"$DOCKER_ENV" <<EOF
COMPOSE_PROFILES=sqlite
WGW_WAIT_FOR_DB=0
WGW_HTTP_PORT=${DOCKER_PORT}
WGW_INSTALL_HEADLESS=1
WGW_INSTALL_ADMIN_USERNAME=${ADMIN_USER}
WGW_INSTALL_ADMIN_EMAIL=${ADMIN_EMAIL}
WGW_INSTALL_ADMIN_PASSWORD=${ADMIN_PASS}
WGW_INSTALL_BASE_URI=/
WGW_DISABLE_LOGIN_THROTTLE=1
EOF

  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$DOCKER_ENV" \
    -p "$DOCKER_PROJECT" \
    down -v --remove-orphans 2>/dev/null || true

  info "Docker route: building image (may take several minutes)..."
  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$DOCKER_ENV" \
    -p "$DOCKER_PROJECT" \
    up -d --build --wait

  local base="http://127.0.0.1:${DOCKER_PORT}"
  wait_health "$base" || fail "Docker: health check failed after fresh install"

  if ! curl -fsS "${base}/api/v1/installer/state" | grep -q '"installed":true'; then
    info "Docker route: headless install not completed by migrator — running wgw:install in web container"
    docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
      --env-file "$DOCKER_ENV" \
      -p "$DOCKER_PROJECT" \
      exec -T web php /var/www/html/packages/api/artisan wgw:install --no-interaction
    wait_health "$base" || fail "Docker: health check failed after wgw:install"
  fi

  local vol="${DOCKER_PROJECT}_wgw-install-config"
  docker run --rm -v "${vol}:/vol:ro" alpine:3.20 sh -c \
    'grep -q WGW_DB_CONNECTION /vol/api.env && ! test -f /vol/wgw-config.php' \
    || fail "Docker: api.env missing WGW_DB_* or wgw-config.php still on volume"

  auth_token "$base" || fail "Docker: auth after fresh install failed"
  pass "Docker fresh install: api.env WGW_*, health + login OK"

  info "Docker route: simulate legacy upgrade on config volume"
  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$DOCKER_ENV" \
    -p "$DOCKER_PROJECT" \
    exec -T web sh -c 'cat > /var/www/html/wgw-config.php <<'"'"'PHP'"'"'
<?php
declare(strict_types=1);
return [
    "data_dir" => "./wgw-content",
    "pdo" => ["sqlite_file" => "./wgw-content/db.sqlite"],
];
PHP'

  docker run --rm -v "${vol}:/vol" alpine:3.20 sh -c \
    "sed -i '/^WGW_DB_/d;/^WGW_DATA_DIR=/d' /vol/api.env"

  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$DOCKER_ENV" \
    -p "$DOCKER_PROJECT" \
    restart web
  sleep 3
  wait_health "$base" || fail "Docker: health failed after legacy inject + restart"

  docker run --rm -v "${vol}:/vol:ro" alpine:3.20 sh -c \
    '! test -f /vol/wgw-config.php && grep -q WGW_DB_CONNECTION /vol/api.env' \
    || fail "Docker upgrade: migrator did not migrate volume config"

  auth_token "$base" || fail "Docker: auth after legacy migration failed"
  pass "Docker legacy migration: boot migrator OK, login still works"

  info "Docker route: rebuild image (simulates setup.sh upgrade) and verify still healthy"
  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$DOCKER_ENV" \
    -p "$DOCKER_PROJECT" \
    up -d --build --wait
  wait_health "$base" || fail "Docker: health failed after rebuild upgrade"
  auth_token "$base" || fail "Docker: auth after rebuild failed"
  pass "Docker rebuild upgrade: health + login OK"

  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$DOCKER_ENV" \
    -p "$DOCKER_PROJECT" \
    down -v --remove-orphans
}

main() {
  info "WeGotWorkspace env-first E2E (branch: $(git branch --show-current))"
  run_zip_e2e
  run_docker_e2e
  pass "All E2E checks passed (ZIP + Docker)"
}

main "$@"
