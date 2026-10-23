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

# Generate APP_KEY only when it is missing or empty. `key:generate --force`
# replaces an existing key, and a new key on every boot breaks everything
# sealed under the old one (refresh tokens, share links, collab ticket key).
ensure_app_key() {
  env_file="$1"
  if [ -n "${APP_KEY:-}" ]; then
    return 0
  fi
  current="$(sed -n 's/^APP_KEY=//p' "$env_file" | head -n 1 | tr -d "\"'[:space:]")"
  if [ -n "$current" ]; then
    return 0
  fi

  # Leave one bare `APP_KEY=` line so key:generate can fill it in.
  # `cat >` keeps the symlink to the config volume and the file mode.
  tmp="$(mktemp)"
  awk 'BEGIN { done = 0 }
    /^APP_KEY=/ { if (!done) { print "APP_KEY="; done = 1 } next }
    { print }
    END { if (!done) print "APP_KEY=" }' "$env_file" >"$tmp"
  cat "$tmp" >"$env_file"
  rm -f "$tmp"

  php "${API_ROOT}/artisan" key:generate --force --no-interaction >/dev/null 2>&1 || true
}

if [ -f "${API_ROOT}/artisan" ] && [ -f "${API_ROOT}/.env" ]; then
  ensure_app_key "${API_ROOT}/.env"
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
