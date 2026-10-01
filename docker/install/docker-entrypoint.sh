#!/bin/sh
set -eu

INSTALL_ROOT="${WGW_APP_ROOT:-/var/www/html}"
API_ROOT="${INSTALL_ROOT}/packages/api"
CONFIG_VOL="${WGW_CONFIG_VOL:-/wgw-config-vol}"

# shellcheck source=/dev/null
. /usr/local/bin/wgw-install-wait-db.sh

# First-boot setup runs as root; Apache (www-data) serves requests afterward.
# Mirrors docker/apache/docker-entrypoint.sh and apps/wegotworkspace/bootstrap/WgwAppBootstrap.php.
if [ "$(id -u)" != "0" ]; then
  echo "[wgw-install] Warning: entrypoint is not root; runtime file setup may fail." >&2
fi

# Install config lives on a named volume; link expected paths for Laravel and the installer.
if [ -d "$CONFIG_VOL" ]; then
  /usr/local/bin/wgw-install-seed-config.sh

  target="${API_ROOT}/.env"
  if [ -d "$target" ]; then
    rm -rf "$target"
  fi

  ln -sf "${CONFIG_VOL}/api.env" "$target"
fi

if [ -f "${API_ROOT}/artisan" ] && [ -f "${API_ROOT}/.env" ]; then
  php "${API_ROOT}/artisan" key:generate --force --no-interaction >/dev/null 2>&1 || true
fi

mkdir -p \
  "${INSTALL_ROOT}/wgw-content" \
  "${API_ROOT}/storage/framework/cache/data" \
  "${API_ROOT}/storage/framework/sessions" \
  "${API_ROOT}/storage/framework/views" \
  "${API_ROOT}/storage/logs" \
  "${API_ROOT}/bootstrap/cache"

if [ "$(id -u)" = "0" ]; then
  chown -R www-data:www-data \
    "${INSTALL_ROOT}/wgw-content" \
    "${API_ROOT}/storage" \
    "${API_ROOT}/bootstrap/cache"

  for path in \
    "${API_ROOT}/.env" \
    "${INSTALL_ROOT}/.htaccess"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      chown -h www-data:www-data "$path" 2>/dev/null || chown www-data:www-data "$path"
    fi
  done

  if [ -d "$CONFIG_VOL" ]; then
    chown -R www-data:www-data "$CONFIG_VOL"
  fi

  # Non-recursive: lets www-data create .env / .htaccess when bootstrap runs before entrypoint re-runs.
  chown www-data:www-data "${INSTALL_ROOT}" "${API_ROOT}"
fi

echo "[wgw-install] Serving ${INSTALL_ROOT} (production install layout; vendor pre-baked in image)."

exec docker-php-entrypoint "$@"
