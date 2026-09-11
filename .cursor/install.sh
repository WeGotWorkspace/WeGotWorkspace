#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the WeGotWorkspace monorepo.
# System deps (PHP 8.3 + Composer) are installed once; JS/PHP project deps and
# the local dev install are refreshed on every run.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- System dependencies: PHP 8.3 (Laravel API) + Composer -------------------
if ! command -v php >/dev/null 2>&1; then
  echo "[install] Installing PHP 8.3 and extensions..."
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    php8.3-cli php8.3-common php8.3-mbstring php8.3-xml php8.3-curl \
    php8.3-sqlite3 php8.3-mysql php8.3-bcmath php8.3-gd php8.3-zip \
    php8.3-intl php8.3-gmp php8.3-imap unzip
else
  echo "[install] PHP already present: $(php --version | head -n1)"
fi

if ! command -v composer >/dev/null 2>&1; then
  echo "[install] Installing Composer..."
  curl -sS https://getcomposer.org/installer -o /tmp/composer-setup.php
  sudo php /tmp/composer-setup.php --install-dir=/usr/local/bin --filename=composer
  rm -f /tmp/composer-setup.php
else
  echo "[install] Composer already present: $(composer --version)"
fi

# --- Project dependencies ----------------------------------------------------
echo "[install] Installing JS workspace dependencies (pnpm)..."
pnpm install --frozen-lockfile

echo "[install] Installing PHP API dependencies (composer)..."
composer install --working-dir packages/api --no-interaction --prefer-dist

# --- Local dev bootstrap (idempotent) ----------------------------------------
# Creates packages/api/.env, sqlite db, JWT keys, admin user, and seed data.
echo "[install] Running local dev install..."
php packages/api/artisan wgw:dev-install

echo "[install] Done."
