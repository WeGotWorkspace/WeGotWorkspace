FROM php:8.3-apache-bookworm

# Extension build deps (match packages/api composer + CI setup-php extensions).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        git \
        unzip \
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

# Modules commonly enabled on shared Apache + cPanel-style hosts.
# Debian Apache ships a default `Alias /icons/ \"/usr/share/apache2/icons/\"` that intercepts PWA manifest icon precache URLs before `.htaccess`/PHP can serve shell dist assets.
# App icons are published under /pwa-icons/ to avoid that conflict on shared hosts; this sed is defense-in-depth for Docker dev.
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
        ssl \
    && sed -i '/^Alias \/icons\//d' /etc/apache2/mods-available/alias.conf \
    && ! grep -q '^Alias /icons/' /etc/apache2/mods-available/alias.conf

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

ENV APACHE_DOCUMENT_ROOT=/var/www/install
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

COPY docker/php/uploads.ini /usr/local/etc/php/conf.d/wgw-uploads.ini
COPY docker/apache/vhost.conf /etc/apache2/conf-available/wgw-vhost.conf
COPY docker/apache/http-vhost.conf /etc/apache2/conf-available/wgw-http-vhost.conf
COPY docker/apache/http-redirect.conf /etc/apache2/conf-available/wgw-http-redirect.conf
COPY docker/apache/ssl-vhost.conf /etc/apache2/conf-available/wgw-ssl-vhost.conf
RUN a2enconf wgw-vhost

COPY docker/apache/docker-entrypoint.sh /usr/local/bin/wgw-apache-entrypoint
RUN chmod +x /usr/local/bin/wgw-apache-entrypoint

WORKDIR /var/www/packages/api

ENTRYPOINT ["wgw-apache-entrypoint"]
CMD ["apache2-foreground"]
