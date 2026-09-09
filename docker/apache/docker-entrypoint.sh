#!/bin/sh
set -eu

INSTALL_ROOT="${WGW_APP_ROOT:-/var/www/install}"
API_ROOT="${WGW_API_ROOT:-/var/www/packages/api}"
export WGW_API_ROOT="${API_ROOT}"
DOMAIN="${WGW_DEV_DOMAIN:-wegotworkspace.localhost}"
CERT_PEM="/etc/apache2/certs/${DOMAIN}.pem"
CERT_KEY="/etc/apache2/certs/${DOMAIN}-key.pem"

if [ ! -f "${INSTALL_ROOT}/wgw-config.php" ] && [ -f "${INSTALL_ROOT}/wgw-config.sample.php" ]; then
  cp "${INSTALL_ROOT}/wgw-config.sample.php" "${INSTALL_ROOT}/wgw-config.php"
fi

if [ -f "${API_ROOT}/composer.json" ] && [ ! -f "${API_ROOT}/vendor/autoload.php" ]; then
  composer install --working-dir="${API_ROOT}" --no-interaction --prefer-dist
fi

if [ -f "${API_ROOT}/.env.example" ] && [ ! -f "${API_ROOT}/.env" ]; then
  cp "${API_ROOT}/.env.example" "${API_ROOT}/.env"
fi
if [ -f "${API_ROOT}/artisan" ] && [ -f "${API_ROOT}/.env" ]; then
  php "${API_ROOT}/artisan" key:generate --force --no-interaction >/dev/null 2>&1 || true
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
