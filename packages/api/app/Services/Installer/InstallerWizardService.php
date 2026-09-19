<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Services\Settings\SettingKeys;
use App\Support\AppPaths;
use App\Support\WgwInstallConfig;
use App\Support\WgwRuntimeEnvBridge;
use Illuminate\Support\Facades\Cache;

final class InstallerWizardService
{
    private const SESSION_KEY = '_sabre_install';

    public function __construct(
        private AppPaths $paths,
        private InstallerEnvChecker $env,
        private InstallerDatabaseInstaller $database,
        private InstallerEnvWriter $envWriter,
        private InstallerJwtKeyGenerator $jwtKeys,
        private ApiRuntimeEnvService $apiEnv,
        private WgwInstallEnv $installEnv,
        private WgwInstallConfig $installConfig,
    ) {}

    /**
     * @return array{installed: bool, maintenance: bool, state: array<string, mixed>}
     */
    public function summary(string $webBase): array
    {
        $this->paths->clearStaleInstallLock();

        return [
            'installed' => $this->paths->isInstalled(),
            'maintenance' => $this->paths->isMaintenance(),
            'state' => $this->runtimeState($webBase),
        ];
    }

    /**
     * @return array{state: array<string, mixed>}
     */
    public function bootstrap(string $webBase): array
    {
        $this->paths->clearStaleInstallLock();

        return [
            'state' => $this->runtimeState($webBase),
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function applyAction(string $webBase, string $action, array $payload): array
    {
        if ($this->paths->isInstalled()) {
            return [
                'ok' => false,
                'error' => 'This instance is already installed.',
                'redirect' => InstallerWebBase::url($webBase, '/admin/updates'),
                'state' => $this->runtimeState($webBase, true),
            ];
        }

        return match ($action) {
            'welcome_next' => $this->actionWelcomeNext($webBase),
            'requirements_check' => $this->actionRequirementsCheck($webBase, $payload),
            'requirements_next' => $this->actionRequirementsNext($webBase, $payload),
            'database_test' => $this->actionDatabaseTest($webBase, $payload),
            'database_next' => $this->actionDatabaseNext($webBase, $payload),
            'site_next' => $this->actionSiteNext($webBase, $payload),
            'install' => $this->actionInstall($webBase, $payload),
            default => ['ok' => false, 'error' => 'Unsupported action'],
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function actionWelcomeNext(string $webBase): array
    {
        $state = $this->wizardState();
        $state['step'] = 'requirements';
        unset($state['_flash']);
        $this->saveWizardState($state);

        return ['ok' => true, 'state' => $this->runtimeState($webBase)];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function actionRequirementsCheck(string $webBase, array $payload): array
    {
        $driver = $this->normalizeDriver($payload['db_driver'] ?? 'sqlite');
        $state = $this->wizardState();
        $currentStep = (string) ($state['step'] ?? 'welcome');
        if (! in_array($currentStep, ['database', 'site', 'account'], true)) {
            $state['step'] = 'requirements';
        }
        $state['db_driver'] = $driver;
        unset($state['_flash']);
        $this->saveWizardState($state);

        return ['ok' => true, 'state' => $this->runtimeState($webBase)];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function actionRequirementsNext(string $webBase, array $payload): array
    {
        $driver = $this->normalizeDriver($payload['db_driver'] ?? 'sqlite');
        $checks = $this->env->checkAll($driver);
        if (! $this->env->allPassed($checks)) {
            $state = $this->wizardState();
            $state['step'] = 'requirements';
            $state['db_driver'] = $driver;
            $state['_flash'] = 'Some requirements are still not met. Fix them, reload, then continue.';
            $this->saveWizardState($state);

            return [
                'ok' => false,
                'error' => $state['_flash'],
                'state' => $this->runtimeState($webBase),
            ];
        }

        $state = $this->wizardState();
        $state['step'] = 'database';
        $state['db_driver'] = $driver;
        unset($state['_flash']);
        $this->saveWizardState($state);

        return ['ok' => true, 'state' => $this->runtimeState($webBase)];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function actionDatabaseTest(string $webBase, array $payload): array
    {
        $db = $this->readDbFromPayload($payload);
        try {
            $this->database->testConnection($db);
        } catch (\Throwable $e) {
            $this->persistDatabaseDraft($db);
            $message = $this->databaseConnectionErrorMessage($db, $e);

            return [
                'ok' => false,
                'error' => $message,
                'state' => $this->runtimeState($webBase),
            ];
        }

        $state = $this->wizardState();
        $state['step'] = 'database';
        $state['db_driver'] = (string) $db['driver'];
        $state['db'] = $db;
        unset($state['_flash']);
        $this->saveWizardState($state);

        return ['ok' => true, 'state' => $this->runtimeState($webBase)];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function actionDatabaseNext(string $webBase, array $payload): array
    {
        $db = $this->readDbFromPayload($payload);
        try {
            $this->database->testConnection($db);
        } catch (\Throwable $e) {
            $flash = $this->databaseConnectionErrorMessage($db, $e);
            $this->persistDatabaseDraft($db, $flash);

            return [
                'ok' => false,
                'error' => $flash,
                'state' => $this->runtimeState($webBase),
            ];
        }

        $state = $this->wizardState();
        $state['step'] = 'site';
        $state['db'] = $db;
        $state['db_driver'] = (string) $db['driver'];
        unset($state['_flash']);
        $this->saveWizardState($state);

        return ['ok' => true, 'state' => $this->runtimeState($webBase)];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function actionSiteNext(string $webBase, array $payload): array
    {
        $override = trim((string) ($payload['base_uri_override'] ?? ''));
        if ($override !== '') {
            $base = $override[0] === '/' ? $override : '/'.$override;
            $base = rtrim($base, '/').'/';
        } else {
            $base = InstallerWebBase::baseUriFromWebBase($webBase);
        }

        $enableFiles = ! empty($payload['enable_files']);
        $enableCalendars = ! empty($payload['enable_calendars']);
        $enableContacts = ! empty($payload['enable_contacts']);
        if (! $enableFiles && ! $enableCalendars && ! $enableContacts) {
            $state = $this->wizardState();
            $state['step'] = 'site';
            $state['_flash'] = 'Enable at least one of WebDAV files, calendars, or contacts.';
            $this->saveWizardState($state);

            return [
                'ok' => false,
                'error' => $state['_flash'],
                'state' => $this->runtimeState($webBase),
            ];
        }

        $state = $this->wizardState();
        $state['step'] = 'account';
        $state['base_uri'] = $base;
        $state['timezone'] = trim((string) ($payload['timezone'] ?? 'UTC')) ?: 'UTC';
        $state['enable_files'] = $enableFiles;
        $state['enable_calendars'] = $enableCalendars;
        $state['enable_contacts'] = $enableContacts;
        $state['show_browser_ui'] = ! empty($payload['show_browser_ui']);
        unset($state['_flash']);
        $this->saveWizardState($state);

        return ['ok' => true, 'state' => $this->runtimeState($webBase)];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function actionInstall(string $webBase, array $payload): array
    {
        if (! $this->allowInstallAttempt()) {
            $state = $this->wizardState();
            $state['_flash'] = 'Too many attempts. Wait a few minutes and try again.';
            $this->saveWizardState($state);

            return [
                'ok' => false,
                'error' => $state['_flash'],
                'state' => $this->runtimeState($webBase),
            ];
        }

        $state = $this->wizardState();
        $state['step'] = 'account';
        $this->saveWizardState($state);

        try {
            $redirect = $this->executeInstall($webBase, $state, $payload);

            return [
                'ok' => true,
                'redirect' => $redirect,
                'state' => $this->runtimeState($webBase),
            ];
        } catch (\RuntimeException $e) {
            return [
                'ok' => false,
                'error' => $e->getMessage(),
                'state' => $this->runtimeState($webBase),
            ];
        }
    }

    /**
     * @param  array<string, mixed>  $state
     * @param  array<string, mixed>  $payload
     */
    public function executeInstall(string $webBase, array $state, array $payload): string
    {
        $username = strtolower(trim((string) ($payload['username'] ?? '')));
        $display = trim((string) ($payload['display_name'] ?? '')) ?: $username;
        $email = trim((string) ($payload['email'] ?? ''));
        $pass = (string) ($payload['password'] ?? '');
        $pass2 = (string) ($payload['password_confirm'] ?? '');

        if (! preg_match('/^[a-z0-9][a-z0-9_-]{1,62}$/', $username)) {
            throw new \RuntimeException('Username must be 2–63 characters: lowercase letters, digits, underscore, or hyphen.');
        }
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new \RuntimeException('Enter a valid email address.');
        }
        if (strlen($pass) < 10) {
            throw new \RuntimeException('Use a password of at least 10 characters.');
        }
        if (! hash_equals($pass, $pass2)) {
            throw new \RuntimeException('Passwords do not match.');
        }

        /** @var array<string, mixed> $db */
        $db = $state['db'] ?? [];
        if ($db === []) {
            throw new \RuntimeException('Your session expired before installation finished. Please start again.');
        }

        $enableCalendars = (bool) ($state['enable_calendars'] ?? true);
        $enableContacts = (bool) ($state['enable_contacts'] ?? true);
        $enableFiles = (bool) ($state['enable_files'] ?? true);
        $mailEnabled = ! empty($payload['mail_enabled']);
        $meetEnabled = ! empty($payload['meet_enabled']);

        if ($enableFiles) {
            @mkdir(rtrim($this->paths->dataDir(), '/').'/files', 0775, true);
        }

        $this->paths->clearStaleInstallLock();
        $this->removeEmptySqliteDatabase($db);

        try {
            if ($this->database->hasUsers($db)) {
                $this->jwtKeys->ensureKeys();
            } else {
                $this->database->installFresh(
                    $db,
                    $username,
                    $pass,
                    $display,
                    $email,
                    $enableCalendars,
                    $enableContacts,
                    [
                        SettingKeys::TIMEZONE => (string) ($state['timezone'] ?? 'UTC'),
                        SettingKeys::BASE_URI => (string) ($state['base_uri'] ?? '/'),
                        SettingKeys::AUTH_REALM => 'SabreDAV',
                        SettingKeys::BROWSER_PLUGIN => (bool) ($state['show_browser_ui'] ?? true),
                        SettingKeys::FILES_ENABLED => $enableFiles,
                        SettingKeys::CALENDAR_ENABLED => $enableCalendars,
                        SettingKeys::CONTACTS_ENABLED => $enableContacts,
                        SettingKeys::MAIL_ENABLED => $mailEnabled,
                        SettingKeys::MAIL_IMAP_HOST => $mailEnabled ? trim((string) ($payload['mail_imap_host'] ?? '')) : '',
                        SettingKeys::MAIL_IMAP_PORT => $mailEnabled ? (int) ($payload['mail_imap_port'] ?? 993) : 993,
                        SettingKeys::MAIL_IMAP_SECURITY => $mailEnabled ? $this->normalizeMailSecurity((string) ($payload['mail_imap_security'] ?? 'ssl'), 'ssl') : '',
                        SettingKeys::MAIL_SMTP_HOST => $mailEnabled ? trim((string) ($payload['mail_smtp_host'] ?? '')) : '',
                        SettingKeys::MAIL_SMTP_PORT => $mailEnabled ? (int) ($payload['mail_smtp_port'] ?? 587) : 587,
                        SettingKeys::MAIL_SMTP_SECURITY => $mailEnabled ? $this->normalizeMailSecurity((string) ($payload['mail_smtp_security'] ?? 'starttls'), 'starttls') : '',
                        SettingKeys::RTC_STUN_URL => $meetEnabled ? trim((string) ($payload['rtc_stun_url'] ?? '')) : '',
                        SettingKeys::RTC_TURN_URL => $meetEnabled ? trim((string) ($payload['rtc_turn_url'] ?? '')) : '',
                        SettingKeys::RTC_TURN_USERNAME => $meetEnabled ? trim((string) ($payload['rtc_turn_username'] ?? '')) : '',
                        SettingKeys::RTC_TURN_CREDENTIAL => $meetEnabled ? (string) ($payload['rtc_turn_credential'] ?? '') : '',
                    ],
                );
                $this->jwtKeys->ensureKeys();
            }
        } catch (\Throwable $e) {
            throw new \RuntimeException('Installation failed: '.$e->getMessage(), 0, $e);
        }

        $bootstrap = [
            'data_dir' => $this->paths->tryRelativeToInstallRoot($this->paths->dataDir()) ?? $this->paths->dataDir(),
            'pdo' => $this->pdoConfigForWrite($db),
        ];

        try {
            $this->envWriter->writeBootstrap($bootstrap);
            WgwRuntimeEnvBridge::apply($this->installConfig);
        } catch (\Throwable) {
            throw new \RuntimeException('Could not write packages/api/.env.');
        }

        if (file_put_contents($this->paths->lockFile(), date('c')."\n", LOCK_EX) === false) {
            throw new \RuntimeException('Database was set up but the install lock file could not be written.');
        }

        $this->apiEnv->ensure($this->paths->installRoot(), $this->resolveAppUrlForInstall());
        @chmod($this->paths->lockFile(), 0600);

        $this->saveWizardState([
            'step' => 'done',
            'installed_base_uri' => (string) ($state['base_uri'] ?? '/'),
            'show_browser_ui' => (bool) ($state['show_browser_ui'] ?? true),
            'enable_files' => $enableFiles,
            'enable_calendars' => $enableCalendars,
            'enable_contacts' => $enableContacts,
        ]);

        $adminPath = InstallerWebBase::url($webBase, '/admin/');

        return InstallerWebBase::url($webBase, '/login?return='.rawurlencode($adminPath));
    }

    /**
     * @return array<string, mixed>
     */
    private function runtimeState(string $webBase, bool $forceInstalled = false): array
    {
        if ($forceInstalled || $this->paths->isInstalled()) {
            return [
                'step' => 'installed',
                'flash' => null,
                'db_driver' => 'sqlite',
                'db' => [],
                'timezone' => 'UTC',
                'base_uri' => InstallerWebBase::baseUriFromWebBase($webBase),
                'enable_files' => true,
                'enable_calendars' => true,
                'enable_contacts' => true,
                'show_browser_ui' => true,
                'checks' => $this->env->checkAll('sqlite'),
                'already_installed' => true,
                'admin_updates_url' => InstallerWebBase::url($webBase, '/admin/updates'),
                'db_from_env' => $this->installEnv->hasDatabaseFromEnv(),
            ];
        }

        $state = $this->mergeEnvDefaults($this->wizardState(), $webBase);
        $step = (string) ($state['step'] ?? 'welcome');
        $allowed = ['welcome', 'requirements', 'database', 'site', 'account', 'done', 'installed'];
        if (! in_array($step, $allowed, true)) {
            $step = 'welcome';
        }

        $driver = $this->normalizeDriver($state['db_driver'] ?? 'sqlite');
        $db = is_array($state['db'] ?? null) ? $state['db'] : [];

        $runtime = [
            'step' => $step,
            'flash' => is_string($state['_flash'] ?? null) ? $state['_flash'] : null,
            'db_driver' => $driver,
            'db' => $this->publicDbState($db),
            'timezone' => (string) ($state['timezone'] ?? 'UTC'),
            'base_uri' => (string) ($state['base_uri'] ?? InstallerWebBase::baseUriFromWebBase($webBase)),
            'enable_files' => (bool) ($state['enable_files'] ?? true),
            'enable_calendars' => (bool) ($state['enable_calendars'] ?? true),
            'enable_contacts' => (bool) ($state['enable_contacts'] ?? true),
            'show_browser_ui' => (bool) ($state['show_browser_ui'] ?? true),
            'checks' => $this->env->checkAll($driver),
            'db_from_env' => $this->installEnv->hasDatabaseFromEnv(),
        ];

        foreach (['admin_username', 'admin_email', 'admin_display_name'] as $adminKey) {
            if (isset($state[$adminKey]) && is_string($state[$adminKey]) && $state[$adminKey] !== '') {
                $runtime[$adminKey] = $state[$adminKey];
            }
        }

        return $runtime;
    }

    /**
     * @param  array<string, mixed>  $state
     * @return array<string, mixed>
     */
    private function mergeEnvDefaults(array $state, string $webBase): array
    {
        $defaults = $this->installEnv->wizardDefaults($webBase);

        if (! isset($state['db_driver']) || $state['db_driver'] === '') {
            $state['db_driver'] = $defaults['db_driver'];
        }

        $sessionDb = is_array($state['db'] ?? null) ? $state['db'] : [];
        $defaultDb = is_array($defaults['db'] ?? null) ? $defaults['db'] : [];
        if ($defaultDb !== []) {
            $state['db'] = array_merge($defaultDb, array_filter(
                $sessionDb,
                static fn (mixed $value): bool => $value !== null && $value !== '',
            ));
        }

        foreach (['timezone', 'base_uri', 'enable_files', 'enable_calendars', 'enable_contacts', 'show_browser_ui'] as $key) {
            if (! array_key_exists($key, $state) || $state[$key] === '' || $state[$key] === null) {
                if (array_key_exists($key, $defaults)) {
                    $state[$key] = $defaults[$key];
                }
            }
        }

        foreach (['admin_username', 'admin_email', 'admin_display_name'] as $key) {
            if ((! isset($state[$key]) || $state[$key] === '') && isset($defaults[$key])) {
                $state[$key] = $defaults[$key];
            }
        }

        return $state;
    }

    /**
     * @return array<string, mixed>
     */
    private function wizardState(): array
    {
        $state = session(self::SESSION_KEY);
        if (! is_array($state)) {
            $state = ['step' => 'welcome'];
            session([self::SESSION_KEY => $state]);

            return $state;
        }

        if (! $this->paths->isInstalled()) {
            $step = (string) ($state['step'] ?? 'welcome');
            if (in_array($step, ['done', 'installed'], true)) {
                $state['step'] = 'welcome';
                unset($state['_flash'], $state['installed_base_uri']);
                session([self::SESSION_KEY => $state]);
            }
        }

        return $state;
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private function saveWizardState(array $state): void
    {
        session([self::SESSION_KEY => $state]);
    }

    /**
     * @param  array<string, mixed>  $db
     */
    private function persistDatabaseDraft(array $db, ?string $flash = null): void
    {
        $state = $this->wizardState();
        $state['step'] = 'database';
        $state['db_driver'] = (string) $db['driver'];
        $state['db'] = $db;
        if ($flash !== null) {
            $state['_flash'] = $flash;
        }
        $this->saveWizardState($state);
    }

    /**
     * @param  array<string, mixed>  $db
     * @return array<string, mixed>
     */
    private function publicDbState(array $db): array
    {
        $out = [];
        if (isset($db['sqlite_path']) && is_string($db['sqlite_path'])) {
            $out['sqlite_path'] = $db['sqlite_path'];
        }
        foreach (['mysql_host', 'mysql_db', 'mysql_user'] as $key) {
            if (isset($db[$key]) && is_string($db[$key])) {
                $out[$key] = $db[$key];
            }
        }
        if (isset($db['mysql_port'])) {
            $out['mysql_port'] = (int) $db['mysql_port'];
        }

        return $out;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function readDbFromPayload(array $payload): array
    {
        $driver = $this->normalizeDriver($payload['db_driver'] ?? 'sqlite');
        if ($driver === 'sqlite') {
            $path = trim((string) ($payload['sqlite_path'] ?? ''));
            if ($path === '') {
                $path = $this->paths->defaultSqliteRelativePath();
            }

            return [
                'driver' => 'sqlite',
                'sqlite_path' => $path,
            ];
        }

        return [
            'driver' => 'mysql',
            'mysql_host' => trim((string) ($payload['mysql_host'] ?? '127.0.0.1')),
            'mysql_port' => (int) ($payload['mysql_port'] ?? 3306),
            'mysql_db' => trim((string) ($payload['mysql_db'] ?? '')),
            'mysql_user' => trim((string) ($payload['mysql_user'] ?? '')),
            'mysql_password' => (string) ($payload['mysql_password'] ?? ''),
        ];
    }

    /**
     * @param  array<string, mixed>  $db
     * @return array<string, mixed>
     */
    private function pdoConfigForWrite(array $db): array
    {
        if (($db['driver'] ?? '') === 'sqlite') {
            $abs = $this->paths->resolveProjectPath((string) ($db['sqlite_path'] ?? $this->paths->defaultSqliteRelativePath()));
            $rel = $this->paths->tryRelativeToInstallRoot($abs);
            if ($rel !== null) {
                return ['sqlite_file' => $rel, 'user' => null, 'password' => null];
            }

            return [
                'dsn' => 'sqlite:'.$abs,
                'user' => null,
                'password' => null,
            ];
        }

        $host = (string) ($db['mysql_host'] ?? '127.0.0.1');
        $port = (int) ($db['mysql_port'] ?? 3306);
        $name = (string) ($db['mysql_db'] ?? '');
        $user = (string) ($db['mysql_user'] ?? '');
        $pass = (string) ($db['mysql_password'] ?? '');
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $host, $port, $name);

        return ['dsn' => $dsn, 'user' => $user, 'password' => $pass];
    }

    private function normalizeDriver(mixed $driver): string
    {
        $driver = is_string($driver) ? $driver : 'sqlite';

        return in_array($driver, ['sqlite', 'mysql'], true) ? $driver : 'sqlite';
    }

    /**
     * @param  array<string, mixed>  $db
     */
    private function databaseConnectionErrorMessage(array $db, \Throwable $e): string
    {
        if (($db['driver'] ?? '') === 'mysql' && ! extension_loaded('pdo_mysql')) {
            return 'PHP MySQL extension (pdo_mysql) is not loaded on this server. Rebuild the API container or enable pdo_mysql in PHP.';
        }

        $detail = $e->getMessage();
        $host = (string) ($db['mysql_host'] ?? '127.0.0.1');
        $port = (string) ($db['mysql_port'] ?? '3306');

        if ($this->databaseErrorMatches($detail, ['2002', '2003', 'Connection refused', "Couldn't connect", 'could not find driver'])) {
            return "Could not reach MySQL at {$host}:{$port}.";
        }
        if ($this->databaseErrorMatches($detail, ['1045', 'Access denied'])) {
            return 'MySQL rejected that username or password.';
        }
        if ($this->databaseErrorMatches($detail, ['1049', 'Unknown database'])) {
            return 'That database does not exist.';
        }

        return 'Could not connect to the database. Check your settings.';
    }

    /**
     * @param  list<string>  $needles
     */
    private function databaseErrorMatches(string $detail, array $needles): bool
    {
        foreach ($needles as $needle) {
            if (str_contains($detail, $needle)) {
                return true;
            }
        }

        return false;
    }

    private function normalizeMailSecurity(string $value, string $fallback): string
    {
        $normalized = strtolower(trim($value));

        return in_array($normalized, ['ssl', 'starttls', 'none'], true) ? $normalized : $fallback;
    }

    /**
     * @param  array<string, mixed>  $db
     */
    private function removeEmptySqliteDatabase(array $db): void
    {
        if (($db['driver'] ?? '') !== 'sqlite') {
            return;
        }

        $path = $this->paths->resolveProjectPath((string) ($db['sqlite_path'] ?? $this->paths->defaultSqliteRelativePath()));
        if (is_file($path) && filesize($path) < 1) {
            @unlink($path);
        }
    }

    private function resolveAppUrlForInstall(): ?string
    {
        $fromRequest = ApiRuntimeEnvService::guessRequestAppUrl();
        if ($fromRequest !== null) {
            return $fromRequest;
        }

        $fromEnv = getenv('APP_URL');
        if (! is_string($fromEnv) || trim($fromEnv) === '') {
            $fromEnv = $_ENV['APP_URL'] ?? null;
        }
        if (is_string($fromEnv) && trim($fromEnv) !== '') {
            return rtrim(trim($fromEnv), '/');
        }

        return null;
    }

    private function allowInstallAttempt(): bool
    {
        if (filter_var(getenv('WGW_DISABLE_INSTALL_THROTTLE') ?: '', FILTER_VALIDATE_BOOL)) {
            return true;
        }

        $ip = (string) (request()->ip() ?? 'local');
        $key = 'wgw-install:'.$ip;

        if (Cache::get($key, 0) >= 5) {
            return false;
        }

        Cache::put($key, (int) Cache::get($key, 0) + 1, now()->addMinutes(10));

        return true;
    }
}
