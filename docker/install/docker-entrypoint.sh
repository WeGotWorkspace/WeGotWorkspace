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

# Create .env / APP_KEY only when missing or unusable; never replace a usable
# key. A new key on every start broke everything sealed under the old one
# (refresh tokens, share links, collab ticket key). Rules and tests live in
# ApiRuntimeEnvService. Non-fatal: the next start retries.
if [ -f "${API_ROOT}/artisan" ] && [ -f "${API_ROOT}/.env" ]; then
  if ! php "${API_ROOT}/artisan" wgw:ensure-env --no-interaction; then
    echo "[wgw-install] Warning: could not ensure APP_KEY in ${API_ROOT}/.env; will retry on next start." >&2
  fi
fi

DATA_DIR="${WGW_DATA_DIR:-${INSTALL_ROOT}/wgw-content}"
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="${INSTALL_ROOT}/${DATA_DIR#./}" ;;
esac
STORAGE_DIR="${WGW_STORAGE_PATH:-${API_ROOT}/storage}"

mkdir -p \
  "$DATA_DIR" \
  "${STORAGE_DIR}/framework/cache/data" \
  "${STORAGE_DIR}/framework/sessions" \
  "${STORAGE_DIR}/framework/views" \
  "${STORAGE_DIR}/logs" \
  "${API_ROOT}/bootstrap/cache"

if [ "$(id -u)" = "0" ]; then
  chown -R www-data:www-data \
    "$DATA_DIR" \
    "$STORAGE_DIR" \
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
