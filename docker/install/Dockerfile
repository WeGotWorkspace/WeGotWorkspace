# Production install image — same document-root layout as the release ZIP (INSTALL.md).
# Build stage runs the monorepo release packager; runtime is Apache + mod_php only (no composer at boot).

FROM php:8.3-cli-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        unzip \
        zip \
        libzip-dev \
        libicu-dev \
        libonig-dev \
        libsqlite3-dev \
    && docker-php-ext-install pdo pdo_sqlite mbstring zip intl \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY INSTALL.md README.md LICENSE THIRD_PARTY_NOTICES.md ./
COPY packages ./packages
COPY apps ./apps
COPY tools ./tools

RUN corepack enable \
    && pnpm install --frozen-lockfile \
    && composer --working-dir packages/api install --no-interaction --prefer-dist --no-dev \
    && cp packages/api/.env.example packages/api/.env \
    && php packages/api/artisan key:generate --force --no-interaction \
    && pnpm run build \
    && node tools/build-wegotworkspace-release.mjs \
    && mkdir -p /release \
    && unzip -q dist/releases/wegotworkspace-deploy-*.zip -d /release

FROM php:8.3-apache-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libonig-dev \
        libzip-dev \
        libicu-dev \
        libxml2-dev \
        libsqlite3-dev \
        default-libmysqlclient-dev \
        libc-client-dev \
        libkrb5-dev \
    && docker-php-ext-configure imap --with-kerberos --with-imap-ssl \
    && docker-php-ext-install \
        pdo \
        pdo_sqlite \
        pdo_mysql \
        mbstring \
        zip \
        intl \
        imap \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN a2enmod \
        rewrite \
        headers \
        env \
        mime \
        dir \
        alias \
        negotiation \
        setenvif \
        deflate \
        filter \
        authz_core \
        authz_host \
        auth_basic \
    && sed -i '/^Alias \/icons\//d' /etc/apache2/mods-available/alias.conf \
    && ! grep -q '^Alias /icons/' /etc/apache2/mods-available/alias.conf

ENV APACHE_DOCUMENT_ROOT=/var/www/html
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

COPY docker/php/uploads.ini /usr/local/etc/php/conf.d/wgw-uploads.ini
COPY docker/install/vhost.conf /etc/apache2/conf-available/wgw-install-vhost.conf
COPY docker/install/http-vhost.conf /etc/apache2/conf-available/wgw-install-http-vhost.conf
RUN a2enconf wgw-install-vhost wgw-install-http-vhost

COPY docker/install/docker-entrypoint.sh /usr/local/bin/wgw-install-entrypoint
COPY docker/install/wgw-install-wait-db.sh /usr/local/bin/wgw-install-wait-db.sh
COPY docker/install/wgw-install-migrate.sh /usr/local/bin/wgw-install-migrate.sh
COPY docker/install/wgw-install-seed-config.sh /usr/local/bin/wgw-install-seed-config.sh
RUN chmod +x \
    /usr/local/bin/wgw-install-entrypoint \
    /usr/local/bin/wgw-install-wait-db.sh \
    /usr/local/bin/wgw-install-migrate.sh \
    /usr/local/bin/wgw-install-seed-config.sh

COPY --from=builder /release/ /var/www/html/
RUN chown -R www-data:www-data \
    /var/www/html/wgw-content \
    /var/www/html/packages/api/storage \
    /var/www/html/packages/api/bootstrap/cache \
    2>/dev/null || true \
    && chown www-data:www-data /var/www/html /var/www/html/packages/api \
    && for path in \
         /var/www/html/wgw-config.php \
         /var/www/html/wgw-config.sample.php \
         /var/www/html/.htaccess \
         /var/www/html/packages/api/.env; do \
         if [ -e "$path" ]; then chown www-data:www-data "$path"; fi; \
       done

WORKDIR /var/www/html

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD curl -fsS http://127.0.0.1/api/v1/health | grep -q '"status":"ok"'

ENTRYPOINT ["wgw-install-entrypoint"]
CMD ["apache2-foreground"]
