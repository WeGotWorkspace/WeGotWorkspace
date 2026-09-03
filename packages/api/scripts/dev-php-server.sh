#!/usr/bin/env bash
set -euo pipefail

# Host PHP built-in server for local dev/preview (default :9080).
# `WGW_PHP_DEV_PORT` lets a second worktree bind the next free port.
# Trap ensures php is stopped when turbo/pnpm exits (Ctrl+C, SIGTERM, or parent death).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ROOT="$(cd "${API_ROOT}/../../apps/wegotworkspace" && pwd)"

php_pid=""

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${php_pid}" ]] && kill -0 "${php_pid}" 2>/dev/null; then
    kill -TERM "${php_pid}" 2>/dev/null || true
    wait "${php_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

(cd "${API_ROOT}" && php artisan wgw:schema-migrate)

PHP_PORT="${WGW_PHP_DEV_PORT:-9080}"
if ! [[ "${PHP_PORT}" =~ ^[0-9]+$ ]] || (( PHP_PORT < 1 || PHP_PORT > 65535 )); then
  echo "error: invalid WGW_PHP_DEV_PORT=${PHP_PORT}" >&2
  exit 1
fi

# Align with docker/php/uploads.ini (32M shared-host conservative). The built-in
# server ignores .htaccess / .user.ini; -d is the only way to raise PHP's 8M default.
echo "API listening on http://127.0.0.1:${PHP_PORT}" >&2
env -u SABRE_BUILD_DIR php \
  -d display_errors=0 \
  -d post_max_size=32M \
  -d upload_max_filesize=32M \
  -S "127.0.0.1:${PHP_PORT}" -t "${APP_ROOT}" "${APP_ROOT}/index.php" &
php_pid=$!
wait "${php_pid}"
