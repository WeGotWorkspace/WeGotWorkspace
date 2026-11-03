#!/bin/sh
set -eu

# Create the runtime directories and, when run as root, hand the shared volumes
# to www-data. Apache (web) and the scheduler both run PHP as www-data.
# Called by the web entrypoint on every start and by the migrator when it
# exits: the migrator runs artisan as root, and the scheduler can start before
# the web entrypoint has fixed what the migrator left behind.

INSTALL_ROOT="${WGW_APP_ROOT:-/var/www/html}"
API_ROOT="${INSTALL_ROOT}/packages/api"
CONFIG_VOL="${WGW_CONFIG_VOL:-/wgw-config-vol}"

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

if [ "$(id -u)" != "0" ]; then
  exit 0
fi

chown -R www-data:www-data \
  "$DATA_DIR" \
  "$STORAGE_DIR" \
  "${API_ROOT}/bootstrap/cache"

if [ -d "$CONFIG_VOL" ]; then
  chown -R www-data:www-data "$CONFIG_VOL"
fi
