#!/bin/sh
set -eu

INSTALL_ROOT="${WGW_APP_ROOT:-/var/www/install}"
API_ROOT="${WGW_API_ROOT:-/var/www/packages/api}"
export WGW_API_ROOT="${API_ROOT}"
DOMAIN="${WGW_DEV_DOMAIN:-wegotworkspace.localhost}"
CERT_PEM="/etc/apache2/certs/${DOMAIN}.pem"
CERT_KEY="/etc/apache2/certs/${DOMAIN}-key.pem"

# Do not copy wgw-config.sample.php → wgw-config.php. Env-first runtime uses
# packages/api/.env. Recreating the legacy file on every container start made
# the request-path migrator rewrite .env (and tear it under concurrent Safari).

if [ -f "${API_ROOT}/composer.json" ] && [ ! -f "${API_ROOT}/vendor/autoload.php" ]; then
  composer install --working-dir="${API_ROOT}" --no-interaction --prefer-dist
fi

if [ -f "${API_ROOT}/.env.example" ] && [ ! -f "${API_ROOT}/.env" ]; then
  cp "${API_ROOT}/.env.example" "${API_ROOT}/.env"
fi
# Generate APP_KEY only when it is missing or empty. `key:generate --force`
# replaces an existing key, which would rewrite the bind-mounted .env on
# every container start. Keep in sync with docker/install/docker-entrypoint.sh.
app_key_value() {
  # Laravel's dotenv uses the last APP_KEY line, so read that one.
  sed -n 's/^APP_KEY=//p' "$1" | tail -n 1 | tr -d "\"'[:space:]"
}

ensure_app_key() {
  env_file="$1"
  if [ -n "${APP_KEY:-}" ] || [ -n "$(app_key_value "$env_file")" ]; then
    return 0
  fi

  # Leave one bare `APP_KEY=` line so key:generate can fill it in.
  # `cat >` keeps the file (and any symlink) in place.
  tmp="$(mktemp)"
  awk 'BEGIN { done = 0 }
    /^APP_KEY=/ { if (!done) { print "APP_KEY="; done = 1 } next }
    { print }
    END { if (!done) print "APP_KEY=" }' "$env_file" >"$tmp"
  cat "$tmp" >"$env_file"
  rm -f "$tmp"

  # Non-fatal: the next start retries while the key is still empty.
  if ! php "${API_ROOT}/artisan" key:generate --force --no-interaction >/dev/null 2>&1 \
    || [ -z "$(app_key_value "$env_file")" ]; then
    echo "[wgw-apache] Warning: could not generate APP_KEY in ${env_file}; will retry on next start." >&2
  fi
}

if [ -f "${API_ROOT}/artisan" ] && [ -f "${API_ROOT}/.env" ]; then
  ensure_app_key "${API_ROOT}/.env"
  php "${API_ROOT}/artisan" wgw:dev-install --no-interaction >/dev/null 2>&1 || true
fi

mkdir -p \
  "${INSTALL_ROOT}/wgw-content" \
  "${API_ROOT}/storage/framework/cache" \
  "${API_ROOT}/storage/framework/sessions" \
  "${API_ROOT}/storage/framework/views" \
  "${API_ROOT}/storage/logs" \
  "${API_ROOT}/bootstrap/cache"
chown -R www-data:www-data "${INSTALL_ROOT}/wgw-content" "${API_ROOT}/storage" 2>/dev/null || true

# TLS: mkcert leaf certs mounted at /etc/apache2/certs (see tools/docker-ssl-setup.sh).
if [ -f "${CERT_PEM}" ] && [ -f "${CERT_KEY}" ]; then
  a2enconf wgw-ssl-vhost wgw-http-redirect 2>/dev/null || true
  a2disconf wgw-http-vhost 2>/dev/null || true
  echo "[wgw-apache] HTTPS enabled for https://${DOMAIN}/ (ports 443/80 in compose)"
else
  a2enconf wgw-http-vhost 2>/dev/null || true
  a2disconf wgw-ssl-vhost wgw-http-redirect 2>/dev/null || true
  echo "[wgw-apache] No TLS certs at ${CERT_PEM} — HTTP only (wgw-http-vhost). Run: pnpm docker:ssl:setup"
fi

exec docker-php-entrypoint "$@"
