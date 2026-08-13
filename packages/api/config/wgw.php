<?php

declare(strict_types=1);

use App\Services\Installer\WgwInstallEnv;
use App\Support\UpdateFeedDefaults;

return [
    'install_root' => env('WGW_APP_ROOT'),
    'data_dir' => env('WGW_DATA_DIR'),
    'update_feed_url' => env('WGW_UPDATE_FEED_URL', UpdateFeedDefaults::MANIFEST_URL),

    /**
     * JMAP envelope blob store (RFC 8620 §6). maxSizeUpload is advertised on
     * the Session resource and enforced on POST /jmap/upload; PHP-level
     * limits (post_max_size) still apply upstream.
     */
    'jmap' => [
        'max_size_upload' => (int) env('WGW_JMAP_MAX_SIZE_UPLOAD', 25_000_000),
        'blob_ttl_hours' => (int) env('WGW_JMAP_BLOB_TTL_HOURS', 24),
    ],
    /** Install channel: `docker` (image pull + setup.sh) or `zip` / unset (Admin web updater). */
    'install_channel' => env('WGW_INSTALL_CHANNEL'),

    /**
     * Installer autofill / headless env (read via {@see WgwInstallEnv}).
     * Set in packages/api/.env or Docker api.env on the wgw-install-config volume.
     *
     * @see docs/install-docker.md#installer-environment-wgw_install_
     */
    'install' => [
        'headless' => env('WGW_INSTALL_HEADLESS', false),
        'db_driver' => env('WGW_INSTALL_DB_DRIVER'),
        'db_sqlite_path' => env('WGW_INSTALL_DB_SQLITE_PATH'),
        'db_host' => env('WGW_INSTALL_DB_HOST'),
        'db_port' => env('WGW_INSTALL_DB_PORT'),
        'db_database' => env('WGW_INSTALL_DB_DATABASE'),
        'db_user' => env('WGW_INSTALL_DB_USER'),
        'db_password' => env('WGW_INSTALL_DB_PASSWORD'),
        'base_uri' => env('WGW_INSTALL_BASE_URI'),
        'base_uri_auto' => env('WGW_INSTALL_BASE_URI_AUTO', false),
        'timezone' => env('WGW_INSTALL_TIMEZONE'),
        'admin_username' => env('WGW_INSTALL_ADMIN_USERNAME'),
        'admin_email' => env('WGW_INSTALL_ADMIN_EMAIL'),
        'admin_password' => env('WGW_INSTALL_ADMIN_PASSWORD'),
        'admin_display_name' => env('WGW_INSTALL_ADMIN_DISPLAY_NAME'),
        'enable_files' => env('WGW_INSTALL_ENABLE_FILES'),
        'enable_calendars' => env('WGW_INSTALL_ENABLE_CALENDARS'),
        'enable_contacts' => env('WGW_INSTALL_ENABLE_CONTACTS'),
        'show_browser_ui' => env('WGW_INSTALL_SHOW_BROWSER_UI'),
    ],

    'auth_realm' => env('WGW_AUTH_REALM', 'SabreDAV'),

    'jwt' => [
        'issuer' => env('WGW_API_JWT_ISSUER', 'wegotworkspace-api'),
        'audience' => env('WGW_API_JWT_AUDIENCE', 'wegotworkspace-clients'),
        'kid' => env('WGW_API_JWT_KID', 'wgw-rs256-v1'),
        'private_key' => env('WGW_API_JWT_PRIVATE_KEY'),
        'public_key' => env('WGW_API_JWT_PUBLIC_KEY'),
        'private_key_path' => env('WGW_API_JWT_PRIVATE_KEY_PATH'),
        'public_key_path' => env('WGW_API_JWT_PUBLIC_KEY_PATH'),
        'previous_kid' => env('WGW_API_JWT_PREVIOUS_KID'),
        'previous_public_key' => env('WGW_API_JWT_PREVIOUS_PUBLIC_KEY'),
        'previous_public_key_path' => env('WGW_API_JWT_PREVIOUS_PUBLIC_KEY_PATH'),
        'access_ttl' => (int) env('WGW_API_JWT_ACCESS_TTL', 3600),
        'refresh_ttl' => (int) env('WGW_API_JWT_REFRESH_TTL', 1209600),
    ],

    'mail' => [
        /** Set {@code WGW_MAIL_SMTP_VERIFY_TLS=false} for local/dev SMTP with self-signed certs. */
        'smtp_verify_tls' => filter_var(env('WGW_MAIL_SMTP_VERIFY_TLS', true), FILTER_VALIDATE_BOOL),
    ],
];
