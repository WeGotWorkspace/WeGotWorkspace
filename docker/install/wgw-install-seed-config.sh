#!/bin/sh
set -eu

# Seed install config into the named volume before web subpath file mounts.
# Docker creates directories (not files) when subpath targets are missing; the
# migrator mounts the full volume here and writes api.env first.

CONFIG_VOL="${WGW_CONFIG_VOL:-/wgw-config-vol}"
INSTALL_ROOT="${WGW_APP_ROOT:-/var/www/html}"
API_ROOT="${INSTALL_ROOT}/packages/api"

ensure_config_file() {
  target="$1"
  source="$2"
  label="$3"

  if [ -d "$target" ]; then
    echo "[wgw-install-seed] Removing invalid directory at ${label}" >&2
    rm -rf "$target"
  fi

  if [ -f "$target" ] && [ -s "$target" ]; then
    return 0
  fi

  if [ ! -f "$source" ]; then
    echo "[wgw-install-seed] Error: template missing: ${source}" >&2
    exit 1
  fi

  cp "$source" "$target"
  echo "[wgw-install-seed] Seeded ${label} from ${source}"
}

mkdir -p "$CONFIG_VOL"

ensure_config_file \
  "${CONFIG_VOL}/api.env" \
  "${API_ROOT}/.env.example" \
  "api.env"

ensure_env_kv() {
  file="$1"
  key="$2"
  value="$3"

  if [ ! -f "$file" ]; then
    return 1
  fi
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    return 0
  fi

  printf '\n# Docker install — upgrade via setup.sh, not Admin Updates\n%s=%s\n' "$key" "$value" >> "$file"
  echo "[wgw-install-seed] Set ${key}=${value} in api.env"
}

ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_CHANNEL" "docker"

# Prefill installer wizard / headless install from compose database settings.
if [ "${WGW_WAIT_FOR_DB:-0}" = "1" ] && [ -n "${WGW_DB_HOST:-}" ]; then
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_DRIVER" "mysql"
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_HOST" "${WGW_DB_HOST}"
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_PORT" "${WGW_DB_PORT:-3306}"
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_DATABASE" "${MARIADB_DATABASE:-${WGW_DB_USERNAME:-wgw}}"
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_USER" "${MARIADB_USER:-${WGW_DB_USERNAME:-wgw}}"
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_PASSWORD" "${MARIADB_PASSWORD:-${WGW_DB_PASSWORD:-wgw}}"
elif [ "${COMPOSE_PROFILES:-mysql}" = "sqlite" ] || [ "${WGW_WAIT_FOR_DB:-1}" = "0" ]; then
  DATA_DIR="${WGW_DATA_DIR:-${INSTALL_ROOT}/wgw-content}"
  case "$DATA_DIR" in
    /*) ;;
    *) DATA_DIR="${INSTALL_ROOT}/${DATA_DIR#./}" ;;
  esac
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_DRIVER" "sqlite"
  ensure_env_kv "${CONFIG_VOL}/api.env" "WGW_INSTALL_DB_SQLITE_PATH" "${DATA_DIR}/db.sqlite"
fi

# Remove mistaken copies from older entrypoints that copied into directory mounts.
for stray in "${CONFIG_VOL}/wgw-config.php" "${CONFIG_VOL}/wgw-config.sample.php" "${CONFIG_VOL}/.env.example"; do
  if [ -f "$stray" ]; then
    rm -f "$stray"
  fi
done

if [ "$(id -u)" = "0" ]; then
  chown -R www-data:www-data "$CONFIG_VOL"
fi
