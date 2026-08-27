#!/usr/bin/env bash
# Wizard-path install e2e: ZIP or Docker × SQLite or MariaDB 11.
# Does not use WGW_INSTALL_HEADLESS. See docs/install-docker-ops.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WAIT_TIMEOUT_S="${WGW_E2E_WAIT_TIMEOUT_S:-90}"
WAIT_INTERVAL_S=2
ADMIN_USER="${WGW_E2E_ADMIN_USERNAME:-admin}"
ADMIN_PASS="${WGW_E2E_ADMIN_PASSWORD:-longpassword99}"
ADMIN_EMAIL="${WGW_E2E_ADMIN_EMAIL:-admin@e2e.test}"
ADMIN_DISPLAY="${WGW_E2E_ADMIN_DISPLAY_NAME:-E2E Admin}"
MYSQL_NAME="${WGW_E2E_MYSQL_DATABASE:-wgw}"
MYSQL_USER="${WGW_E2E_MYSQL_USERNAME:-wgw}"
MYSQL_PASS="${WGW_E2E_MYSQL_PASSWORD:-wgw}"
MYSQL_ROOT_PASS="${WGW_E2E_MYSQL_ROOT_PASSWORD:-wgw-root}"
MARIADB_IMAGE="${WGW_E2E_MARIADB_IMAGE:-mariadb:11}"

WORK=""
ZIP_PHP_PID=""
MARIADB_CID=""
COMPOSE_PROJECT=""
COMPOSE_ENV=""
HIDDEN_ZIPS=""

pass() { printf '✅ %s\n' "$*"; }
fail() { printf '❌ %s\n' "$*" >&2; exit 1; }
info() { printf '==> %s\n' "$*"; }

abspath() {
  local target="$1"
  (cd "$(dirname "$target")" && printf '%s/%s\n' "$(pwd -P)" "$(basename "$target")")
}

php_has_ext() {
  local ext="$1"
  php -r "exit(extension_loaded('${ext}') ? 0 : 1);"
}

usage() {
  cat <<EOF
usage:
  tools/e2e-install-matrix.sh <channel> <db>
  tools/e2e-install-matrix.sh --all

channel: zip | docker
db:      sqlite | mysql

Examples:
  pnpm test:install-e2e -- zip sqlite
  WGW_E2E_ZIP=/path/to/wegotworkspace-deploy-x.y.z.zip pnpm test:install-e2e -- docker mysql
  WGW_E2E_BUILD_ZIP=1 pnpm test:install-e2e -- zip sqlite
EOF
  exit 1
}

cleanup_cell() {
  if [[ -n "$ZIP_PHP_PID" ]]; then
    kill "$ZIP_PHP_PID" 2>/dev/null || true
    wait "$ZIP_PHP_PID" 2>/dev/null || true
    ZIP_PHP_PID=""
  fi
  if [[ -n "$MARIADB_CID" ]]; then
    docker rm -f "$MARIADB_CID" >/dev/null 2>&1 || true
    MARIADB_CID=""
  fi
  if [[ -n "$COMPOSE_PROJECT" && -n "$COMPOSE_ENV" && -f "$COMPOSE_ENV" ]]; then
    docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
      --env-file "$COMPOSE_ENV" \
      -p "$COMPOSE_PROJECT" \
      down -v --remove-orphans >/dev/null 2>&1 || true
    COMPOSE_PROJECT=""
    COMPOSE_ENV=""
  fi
  if [[ -n "$HIDDEN_ZIPS" && -d "$HIDDEN_ZIPS" ]]; then
    mv "$HIDDEN_ZIPS"/wegotworkspace-deploy-*.zip "${ROOT}/dist/releases/" 2>/dev/null || true
    rmdir "$HIDDEN_ZIPS" 2>/dev/null || true
    HIDDEN_ZIPS=""
  fi
  if [[ -n "$WORK" && -d "$WORK" && "${WGW_E2E_KEEP_WORK:-0}" != "1" ]]; then
    rm -rf "$WORK"
  fi
  WORK=""
}

cleanup() {
  local status=$?
  cleanup_cell
  return "$status"
}

trap cleanup EXIT

wait_until() {
  local desc="$1"
  shift
  local elapsed=0
  while ((elapsed < WAIT_TIMEOUT_S)); do
    if "$@"; then
      return 0
    fi
    sleep "$WAIT_INTERVAL_S"
    elapsed=$((elapsed + WAIT_INTERVAL_S))
  done
  fail "Timed out after ${WAIT_TIMEOUT_S}s waiting for ${desc}"
}

health_ok() {
  local base="$1"
  curl -fsS "${base}/api/v1/health" 2>/dev/null | grep -q '"status":"ok"'
}

mariadb_ready() {
  local cid="$1"
  docker exec "$cid" mariadb-admin ping -h 127.0.0.1 -u root -p"${MYSQL_ROOT_PASS}" --silent >/dev/null 2>&1
}

ensure_php() {
  command -v php >/dev/null || fail "php is required for the ZIP cell"
  php -r 'exit(version_compare(PHP_VERSION, "8.3.0", ">=") ? 0 : 1);' \
    || fail "PHP 8.3+ is required for the ZIP cell"
  local ext
  for ext in pdo pdo_sqlite pdo_mysql dom mbstring json ctype iconv simplexml openssl; do
    php_has_ext "$ext" || fail "PHP extension ${ext} is required for the ZIP wizard server-check"
  done
}

find_deploy_zip() {
  if [[ -n "${WGW_E2E_ZIP:-}" ]]; then
    [[ -f "$WGW_E2E_ZIP" ]] || fail "WGW_E2E_ZIP is not a file: $WGW_E2E_ZIP"
    printf '%s\n' "$WGW_E2E_ZIP"
    return 0
  fi
  local latest=""
  latest="$(ls -1t "${ROOT}"/dist/releases/wegotworkspace-deploy-*.zip 2>/dev/null | head -1 || true)"
  if [[ -n "$latest" ]]; then
    printf '%s\n' "$latest"
    return 0
  fi
  if [[ "${WGW_E2E_BUILD_ZIP:-0}" == "1" ]]; then
    info "Building deploy ZIP (pnpm run build + tools/build-wegotworkspace-release.mjs)"
    (cd "$ROOT" && pnpm run build && node tools/build-wegotworkspace-release.mjs)
    latest="$(ls -1t "${ROOT}"/dist/releases/wegotworkspace-deploy-*.zip 2>/dev/null | head -1 || true)"
    [[ -n "$latest" ]] || fail "Release packager did not write dist/releases/wegotworkspace-deploy-*.zip"
    printf '%s\n' "$latest"
    return 0
  fi
  fail "No deploy ZIP found. Set WGW_E2E_ZIP, place wegotworkspace-deploy-*.zip in dist/releases/, or set WGW_E2E_BUILD_ZIP=1."
}

isolate_deploy_zip() {
  local zip="$1"
  mkdir -p "${ROOT}/dist/releases"
  local dest="${ROOT}/dist/releases/$(basename "$zip")"
  if [[ "$(abspath "$zip")" != "$(abspath "$dest")" ]]; then
    cp "$zip" "$dest"
    zip="$dest"
  fi
  local extras=()
  local candidate
  for candidate in "${ROOT}"/dist/releases/wegotworkspace-deploy-*.zip; do
    [[ -f "$candidate" ]] || continue
    if [[ "$(abspath "$candidate")" != "$(abspath "$zip")" ]]; then
      extras+=("$candidate")
    fi
  done
  if ((${#extras[@]} > 0)); then
    HIDDEN_ZIPS="$(mktemp -d "${TMPDIR:-/tmp}/wgw-e2e-hidden-zips.XXXXXX")"
    for candidate in "${extras[@]}"; do
      mv "$candidate" "$HIDDEN_ZIPS/"
    done
  fi
  printf '%s\n' "$zip"
}

bootstrap_zip_env() {
  local api="$1"
  [[ -f "${api}/vendor/autoload.php" ]] || {
    info "ZIP: composer install --no-dev in packages/api"
    composer --working-dir "$api" install --no-interaction --prefer-dist --no-dev
  }
  if [[ ! -f "${api}/.env" ]]; then
    [[ -f "${api}/.env.example" ]] || fail "ZIP is missing packages/api/.env.example"
    cp "${api}/.env.example" "${api}/.env"
    php "${api}/artisan" key:generate --force --no-interaction
  fi
  mkdir -p "${api}/storage/framework/cache" \
    "${api}/storage/framework/sessions" \
    "${api}/storage/framework/views" \
    "${api}/storage/logs" \
    "${api}/bootstrap/cache"
  if ! grep -q '^WGW_DISABLE_LOGIN_THROTTLE=' "${api}/.env"; then
    printf '\nWGW_DISABLE_LOGIN_THROTTLE=1\n' >>"${api}/.env"
  else
    sed -i.bak 's/^WGW_DISABLE_LOGIN_THROTTLE=.*/WGW_DISABLE_LOGIN_THROTTLE=1/' "${api}/.env"
    rm -f "${api}/.env.bak"
  fi
  if ! grep -q '^WGW_DISABLE_INSTALL_THROTTLE=' "${api}/.env"; then
    printf 'WGW_DISABLE_INSTALL_THROTTLE=1\n' >>"${api}/.env"
  else
    sed -i.bak 's/^WGW_DISABLE_INSTALL_THROTTLE=.*/WGW_DISABLE_INSTALL_THROTTLE=1/' "${api}/.env"
    rm -f "${api}/.env.bak"
  fi
  # Wizard must run: never set WGW_INSTALL_HEADLESS or admin prefills.
  sed -i.bak '/^WGW_INSTALL_HEADLESS=/d;/^WGW_INSTALL_ADMIN_/d' "${api}/.env"
  rm -f "${api}/.env.bak"
}

start_zip_mariadb() {
  local port="$1"
  info "Starting ${MARIADB_IMAGE} on 127.0.0.1:${port}"
  MARIADB_CID="$(
    docker run -d \
      --name "wgw-e2e-install-mariadb-$$" \
      -e MARIADB_ROOT_PASSWORD="${MYSQL_ROOT_PASS}" \
      -e MARIADB_DATABASE="${MYSQL_NAME}" \
      -e MARIADB_USER="${MYSQL_USER}" \
      -e MARIADB_PASSWORD="${MYSQL_PASS}" \
      -p "127.0.0.1:${port}:3306" \
      "${MARIADB_IMAGE}"
  )"
  wait_until "MariaDB 11 on :${port}" mariadb_ready "$MARIADB_CID"
}

start_zip_server() {
  local zip_dir="$1"
  local port="$2"
  export WGW_APP_ROOT="$zip_dir"
  export WGW_DISABLE_LOGIN_THROTTLE=1
  export WGW_DISABLE_INSTALL_THROTTLE=1
  php -S "127.0.0.1:${port}" -t "$zip_dir" "${zip_dir}/index.php" \
    >"${WORK}/php-server.log" 2>&1 &
  ZIP_PHP_PID=$!
  wait_until "ZIP php -S on :${port}" health_ok "http://127.0.0.1:${port}"
}

write_compose_env() {
  local dest="$1"
  local image="$2"
  local port="$3"
  local profile="$4"
  cat >"$dest" <<EOF
COMPOSE_PROFILES=${profile}
WGW_IMAGE=${image}
WGW_HTTP_PORT=${port}
WGW_INSTALL_HEADLESS=0
WGW_DISABLE_LOGIN_THROTTLE=1
WGW_DISABLE_INSTALL_THROTTLE=1
WGW_INSTALL_ADMIN_USERNAME=
WGW_INSTALL_ADMIN_EMAIL=
WGW_INSTALL_ADMIN_PASSWORD=
EOF
  if [[ "$profile" == "sqlite" ]]; then
    cat >>"$dest" <<EOF
WGW_WAIT_FOR_DB=0
WGW_DB_HOST=
EOF
  else
    cat >>"$dest" <<EOF
WGW_WAIT_FOR_DB=1
WGW_DB_HOST=db
WGW_DB_PORT=3306
WGW_DB_USERNAME=${MYSQL_USER}
WGW_DB_PASSWORD=${MYSQL_PASS}
MARIADB_ROOT_PASSWORD=${MYSQL_ROOT_PASS}
MARIADB_DATABASE=${MYSQL_NAME}
MARIADB_USER=${MYSQL_USER}
MARIADB_PASSWORD=${MYSQL_PASS}
EOF
  fi
}

ensure_runtime_image() {
  local zip="$1"
  local image="$2"
  if [[ "${WGW_E2E_SKIP_IMAGE_BUILD:-0}" == "1" ]]; then
    docker image inspect "$image" >/dev/null 2>&1 \
      || fail "WGW_E2E_SKIP_IMAGE_BUILD=1 but image ${image} is missing"
    return 0
  fi
  isolate_deploy_zip "$zip" >/dev/null
  info "Building runtime image ${image} from Dockerfile.runtime (ZIP, not monorepo Dockerfile)"
  docker build \
    -f "${ROOT}/docker/install/Dockerfile.runtime" \
    -t "$image" \
    "$ROOT"
}

run_playwright() {
  local base="$1"
  local db="$2"
  local mysql_host="$3"
  local mysql_port="$4"
  info "Playwright install.fresh.spec.ts against ${base} (db=${db})"
  (
    cd "$ROOT"
    WGW_API_E2E_NO_SERVER=1 \
      WGW_INSTALL_FRESH=1 \
      WGW_INSTALL_BASE_URL="$base" \
      WGW_E2E_DB="$db" \
      WGW_E2E_ADMIN_USERNAME="$ADMIN_USER" \
      WGW_E2E_ADMIN_PASSWORD="$ADMIN_PASS" \
      WGW_E2E_ADMIN_EMAIL="$ADMIN_EMAIL" \
      WGW_E2E_ADMIN_DISPLAY_NAME="$ADMIN_DISPLAY" \
      WGW_E2E_MYSQL_HOST="$mysql_host" \
      WGW_E2E_MYSQL_PORT="$mysql_port" \
      WGW_E2E_MYSQL_DATABASE="$MYSQL_NAME" \
      WGW_E2E_MYSQL_USERNAME="$MYSQL_USER" \
      WGW_E2E_MYSQL_PASSWORD="$MYSQL_PASS" \
      pnpm --filter @wgw/api exec playwright test e2e/install.fresh.spec.ts
  )
}

run_zip_cell() {
  local db="$1"
  ensure_php
  command -v unzip >/dev/null || fail "unzip is required for the ZIP cell"
  local zip port mysql_port
  zip="$(find_deploy_zip)"
  port="${WGW_E2E_HTTP_PORT:-18091}"
  mysql_port="${WGW_E2E_MYSQL_PORT:-13306}"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/wgw-e2e-install-zip.XXXXXX")"
  info "ZIP cell (${db}): unzip $(basename "$zip")"
  unzip -q "$zip" -d "$WORK"
  mkdir -p "${WORK}/wgw-content"
  bootstrap_zip_env "${WORK}/packages/api"
  if [[ "$db" == "mysql" ]]; then
    command -v docker >/dev/null || fail "docker is required for ZIP + MariaDB"
    start_zip_mariadb "$mysql_port"
  fi
  start_zip_server "$WORK" "$port"
  run_playwright "http://127.0.0.1:${port}" "$db" "127.0.0.1" "$mysql_port"
  pass "ZIP + ${db} wizard + admin login"
}

run_docker_cell() {
  local db="$1"
  command -v docker >/dev/null || fail "docker is required for the Docker cell"
  local zip image port profile mysql_host
  zip="$(find_deploy_zip)"
  image="${WGW_IMAGE:-wgw-install-e2e:local}"
  port="${WGW_E2E_HTTP_PORT:-18093}"
  profile="sqlite"
  mysql_host="127.0.0.1"
  if [[ "$db" == "mysql" ]]; then
    profile="mysql"
    mysql_host="db"
  fi
  ensure_runtime_image "$zip" "$image"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/wgw-e2e-install-docker.XXXXXX")"
  COMPOSE_ENV="${WORK}/compose.env"
  COMPOSE_PROJECT="wgw-e2e-install-${profile}-$$"
  write_compose_env "$COMPOSE_ENV" "$image" "$port" "$profile"
  info "Docker cell (${db}): compose up without --build (image ${image})"
  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$COMPOSE_ENV" \
    -p "$COMPOSE_PROJECT" \
    down -v --remove-orphans >/dev/null 2>&1 || true
  local compose_up=(up -d --wait --no-build)
  if docker compose up --help 2>/dev/null | grep -q -- '--pull'; then
    compose_up+=(--pull never)
  fi
  docker compose -f "${ROOT}/docker/install/docker-compose.yml" \
    --env-file "$COMPOSE_ENV" \
    -p "$COMPOSE_PROJECT" \
    "${compose_up[@]}"
  wait_until "Docker health on :${port}" health_ok "http://127.0.0.1:${port}"
  run_playwright "http://127.0.0.1:${port}" "$db" "$mysql_host" "3306"
  pass "Docker + ${db} wizard + admin login"
}

run_cell() {
  local channel="$1"
  local db="$2"
  cleanup_cell
  case "$channel" in
    zip) run_zip_cell "$db" ;;
    docker) run_docker_cell "$db" ;;
    *) fail "Unknown channel: $channel (expected zip or docker)" ;;
  esac
}

main() {
  local channel="" db="" run_all=0
  if [[ $# -eq 0 ]]; then
    usage
  fi
  if [[ "$1" == "--all" ]]; then
    run_all=1
    shift
  elif [[ "$1" == "-h" || "$1" == "--help" ]]; then
    usage
  else
    [[ $# -ge 2 ]] || usage
    channel="$1"
    db="$2"
  fi

  if [[ "$run_all" -eq 1 ]]; then
    local pair
    for pair in "zip sqlite" "zip mysql" "docker sqlite" "docker mysql"; do
      # shellcheck disable=SC2086
      run_cell $pair
    done
    pass "All install-e2e matrix cells passed"
    return 0
  fi

  case "$channel" in
    zip | docker) ;;
    *) fail "Unknown channel: $channel (expected zip or docker)" ;;
  esac
  case "$db" in
    sqlite | mysql) ;;
    *) fail "Unknown db: $db (expected sqlite or mysql)" ;;
  esac
  run_cell "$channel" "$db"
}

main "$@"
