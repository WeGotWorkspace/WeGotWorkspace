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

echo "[wgw-install-migrate] Running wgw:schema-migrate..."
exec php "${API_ROOT}/artisan" wgw:schema-migrate
