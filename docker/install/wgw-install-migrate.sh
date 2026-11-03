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

# The migrator runs artisan as root, so the log, cache, and SQLite files it
# creates on the shared volumes are root-owned. The scheduler (www-data) starts
# as soon as the migrator exits, possibly before the web entrypoint fixes
# ownership, so hand the volumes to www-data on every exit path. The exit
# status stays the migration's own; the web entrypoint retries the fix.
prepare_dirs_on_exit() {
  status=$?
  if ! /usr/local/bin/wgw-install-prepare-dirs.sh; then
    echo "[wgw-install-migrate] Warning: could not hand the data and storage volumes to www-data." >&2
  fi
  exit "$status"
}
trap prepare_dirs_on_exit EXIT

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
# No exec: the EXIT trap has to run after the migration.
php "${API_ROOT}/artisan" wgw:schema-migrate
