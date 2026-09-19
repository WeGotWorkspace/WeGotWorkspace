<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;

/**
 * Reads install-time env via {@see config('wgw.install')} for wizard autofill and headless install.
 *
 * @see config/wgw.php install section
 * @see docs/install-docker.md
 */
final class WgwInstallEnv
{
    public function __construct(private AppPaths $paths) {}

    public function isHeadlessEnabled(): bool
    {
        return $this->configBool('headless');
    }

    /** True when `WGW_INSTALL_DB_DRIVER` is set — first-run skips the Database screen. */
    public function hasDatabaseFromEnv(): bool
    {
        return $this->configString('db_driver') !== null;
    }

    /**
     * Partial wizard state merged into bootstrap/runtime responses (never includes passwords).
     *
     * @return array<string, mixed>
     */
    public function wizardDefaults(string $webBase): array
    {
        $driver = $this->normalizedDriver();
        $defaults = [
            'db_driver' => $driver,
            'db' => $this->dbDefaults($driver),
            'timezone' => $this->configString('timezone') ?? 'UTC',
            'base_uri' => $this->resolveBaseUri($webBase, false),
            'enable_files' => $this->configBool('enable_files', true),
            'enable_calendars' => $this->configBool('enable_calendars', true),
            'enable_contacts' => $this->configBool('enable_contacts', true),
            'show_browser_ui' => $this->configBool('show_browser_ui', true),
        ];

        $username = $this->configString('admin_username');
        if ($username !== null) {
            $defaults['admin_username'] = strtolower($username);
        }
        $email = $this->configString('admin_email');
        if ($email !== null) {
            $defaults['admin_email'] = $email;
        }
        $display = $this->configString('admin_display_name');
        if ($display !== null) {
            $defaults['admin_display_name'] = $display;
        }

        return $defaults;
    }

    /**
     * @return array{state: array<string, mixed>, payload: array<string, mixed>}|null
     */
    public function headlessPlan(string $webBase): ?array
    {
        if (! $this->isHeadlessEnabled()) {
            return null;
        }

        $driver = $this->normalizedDriver();
        $db = $this->dbConfig($driver);
        if ($db === null) {
            return null;
        }

        $username = strtolower(trim((string) ($this->configString('admin_username') ?? '')));
        $email = trim((string) ($this->configString('admin_email') ?? ''));
        $password = (string) ($this->configString('admin_password') ?? '');
        $display = trim((string) ($this->configString('admin_display_name') ?? '')) ?: $username;

        if (
            $username === ''
            || $email === ''
            || filter_var($email, FILTER_VALIDATE_EMAIL) === false
            || strlen($password) < 10
        ) {
            return null;
        }

        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $username)) {
            return null;
        }

        $baseUri = $this->resolveBaseUri($webBase, true);
        if ($baseUri === null) {
            return null;
        }

        return [
            'state' => [
                'db' => $db,
                'db_driver' => $driver,
                'timezone' => $this->configString('timezone') ?? 'UTC',
                'base_uri' => $baseUri,
                'enable_files' => $this->configBool('enable_files', true),
                'enable_calendars' => $this->configBool('enable_calendars', true),
                'enable_contacts' => $this->configBool('enable_contacts', true),
                'show_browser_ui' => $this->configBool('show_browser_ui', true),
            ],
            'payload' => [
                'username' => $username,
                'display_name' => $display,
                'email' => $email,
                'password' => $password,
                'password_confirm' => $password,
                'mail_enabled' => false,
                'meet_enabled' => false,
            ],
        ];
    }

    private function normalizedDriver(): string
    {
        $driver = strtolower(trim((string) ($this->configString('db_driver') ?? 'sqlite')));

        return in_array($driver, ['sqlite', 'mysql'], true) ? $driver : 'sqlite';
    }

    /**
     * @return array<string, mixed>
     */
    private function dbDefaults(string $driver): array
    {
        $config = $this->dbConfig($driver);
        if ($config === null) {
            return $driver === 'mysql'
                ? []
                : ['sqlite_path' => $this->paths->defaultSqliteRelativePath()];
        }

        $out = [];
        if ($driver === 'sqlite') {
            $out['sqlite_path'] = (string) ($config['sqlite_path'] ?? $this->paths->defaultSqliteRelativePath());
        } else {
            foreach (['mysql_host', 'mysql_port', 'mysql_db', 'mysql_user'] as $key) {
                if (isset($config[$key])) {
                    $out[$key] = $config[$key];
                }
            }
        }

        return $out;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function dbConfig(string $driver): ?array
    {
        if ($driver === 'sqlite') {
            $path = $this->configString('db_sqlite_path');
            if ($path === null) {
                $path = $this->paths->defaultSqliteRelativePath();
            }

            return [
                'driver' => 'sqlite',
                'sqlite_path' => $path,
            ];
        }

        $host = $this->configString('db_host');
        $database = $this->configString('db_database');
        $user = $this->configString('db_user');
        $password = $this->configString('db_password');
        if ($host === null || $database === null || $user === null || $password === null) {
            return null;
        }

        $port = (int) ($this->configString('db_port') ?? '3306');

        return [
            'driver' => 'mysql',
            'mysql_host' => $host,
            'mysql_port' => $port > 0 ? $port : 3306,
            'mysql_db' => $database,
            'mysql_user' => $user,
            'mysql_password' => $password,
        ];
    }

    private function resolveBaseUri(string $webBase, bool $requireExplicit): ?string
    {
        $explicit = $this->configString('base_uri');
        if ($explicit !== null) {
            $base = $explicit[0] === '/' ? $explicit : '/'.$explicit;

            return rtrim($base, '/').'/';
        }

        if ($this->configBool('base_uri_auto')) {
            $appUrl = config('app.url');
            if (is_string($appUrl) && trim($appUrl) !== '') {
                $path = parse_url($appUrl, PHP_URL_PATH);
                if (is_string($path) && $path !== '' && $path !== '/') {
                    return rtrim($path, '/').'/';
                }
            }

            return InstallerWebBase::baseUriFromWebBase($webBase);
        }

        if ($requireExplicit) {
            return null;
        }

        return InstallerWebBase::baseUriFromWebBase($webBase);
    }

    private function configString(string $key): ?string
    {
        $value = config('wgw.install.'.$key);
        if (! is_string($value) && ! is_numeric($value)) {
            return null;
        }
        $trimmed = trim((string) $value);

        return $trimmed === '' ? null : $trimmed;
    }

    private function configBool(string $key, bool $default = false): bool
    {
        $value = config('wgw.install.'.$key);
        if ($value === null || $value === '') {
            return $default;
        }

        return filter_var($value, FILTER_VALIDATE_BOOL);
    }
}
