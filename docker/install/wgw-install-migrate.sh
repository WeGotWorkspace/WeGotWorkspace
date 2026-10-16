#!/bin/sh
set -eu

INSTALL_ROOT="${WGW_APP_ROOT:-/var/www/html}"
API_ROOT="${INSTALL_ROOT}/packages/api"
DATA_DIR="${WGW_DATA_DIR:-${INSTALL_ROOT}/wgw-content}"
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="${INSTALL_ROOT}/${DATA_DIR#./}" ;;
esac
INSTALLED_LOCK="${DATA_DIR}/.installed"

# shellcheck source=/dev/null
. /usr/local/bin/wgw-install-wait-db.sh

/usr/local/bin/wgw-install-seed-config.sh

if [ ! -f "$INSTALLED_LOCK" ]; then
  if [ "${WGW_INSTALL_HEADLESS:-}" = "1" ]; then
    if [ ! -f "${API_ROOT}/artisan" ]; then
      echo "[wgw-install-migrate] Error: artisan not found at ${API_ROOT}/artisan" >&2
      exit 1
    fi
    echo "[wgw-install-migrate] Fresh install — attempting headless wgw:install..."
    if php "${API_ROOT}/artisan" wgw:install; then
      if [ -f "$INSTALLED_LOCK" ]; then
        echo "[wgw-install-migrate] Headless install complete."
        exit 0
      fi
    fi
    echo "[wgw-install-migrate] Headless install skipped (incomplete env or requirements); web wizard will run."
  else
    echo "[wgw-install-migrate] Fresh install (no ${INSTALLED_LOCK}); skipping schema migration."
  fi
  exit 0
fi

if [ ! -f "${API_ROOT}/artisan" ]; then
  echo "[wgw-install-migrate] Error: artisan not found at ${API_ROOT}/artisan" >&2
  exit 1
fi

CONFIG_VOL="${WGW_CONFIG_VOL:-/wgw-config-vol}"
if [ -f "${CONFIG_VOL}/api.env" ]; then
  if [ -d "${API_ROOT}/.env" ]; then
    rm -rf "${API_ROOT}/.env"
  fi
  ln -sf "${CONFIG_VOL}/api.env" "${API_ROOT}/.env"
fi

set_env_kv() {
  file="$1"
  key="$2"
  value="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed --follow-symlinks -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# .env.example ships WGW_DB_DATABASE=./wgw-content/db.sqlite. That path is
# resolved from the install root, so it ignores an absolute WGW_DATA_DIR from
# compose and Laravel looks for /var/www/html/wgw-content/db.sqlite.
if [ -f "${API_ROOT}/.env" ] && [ -n "${WGW_DATA_DIR:-}" ] && [ "${WGW_DATA_DIR#/}" != "$WGW_DATA_DIR" ]; then
  current_db="$(grep -E '^WGW_DB_DATABASE=' "${API_ROOT}/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)"
  case "$current_db" in
    ""|./wgw-content/db.sqlite|wgw-content/db.sqlite)
      set_env_kv "${API_ROOT}/.env" "WGW_DB_DATABASE" "${DATA_DIR}/db.sqlite"
      ;;
  esac
fi

# Laravel will not open a sqlite database that does not exist yet. The install
# lock can land before db.sqlite (the release smoke plants only .installed).
mkdir -p "$DATA_DIR"
db_file="${DATA_DIR}/db.sqlite"
driver=""
if [ -f "${API_ROOT}/.env" ]; then
  driver="$(grep -E '^WGW_DB_CONNECTION=' "${API_ROOT}/.env" | tail -1 | cut -d= -f2- | tr -d '[:space:]' || true)"
fi
if [ -z "$driver" ]; then
  driver="${WGW_DB_CONNECTION:-sqlite}"
fi
if [ "$driver" = "sqlite" ] && [ ! -f "$db_file" ]; then
  : > "$db_file"
  chmod 660 "$db_file" || true
  if [ "$(id -u)" = "0" ]; then
    chown www-data:www-data "$db_file" || true
  fi
fi

echo "[wgw-install-migrate] Running wgw:schema-migrate..."
exec php "${API_ROOT}/artisan" wgw:schema-migrate
