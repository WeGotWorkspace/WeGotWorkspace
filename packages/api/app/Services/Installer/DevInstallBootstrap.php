<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Services\Settings\SettingKeys;
use App\Support\AppPaths;
use App\Support\WgwInstallConfig;
use App\Support\WgwRuntimeEnvBridge;

/**
 * Idempotent local-dev install: packages/api/.env WGW_* keys, SQLite schema, admin user, JWT keys.
 *
 * Used by {@code pnpm dev} / {@code pnpm preview} so login works without the web installer.
 */
final class DevInstallBootstrap
{
    public function __construct(
        private AppPaths $paths,
        private InstallerEnvWriter $envWriter,
        private InstallerDatabaseInstaller $database,
        private InstallerJwtKeyGenerator $jwtKeys,
        private ApiRuntimeEnvService $apiEnv,
        private WgwInstallConfig $installConfig,
    ) {}

    /**
     * @return bool true when a fresh database was created; false when already installed
     */
    public function ensure(?string $username = null, ?string $password = null): bool
    {
        $username = strtolower(trim($username ?? (string) (getenv('WGW_DEV_USERNAME') ?: 'admin')));
        $password = (string) ($password ?? (getenv('WGW_DEV_PASSWORD') ?: 'storybook-dev'));

        $this->paths->clearStaleInstallLock();

        if ($this->paths->isInstalled()) {
            $this->jwtKeys->ensureKeys();

            return false;
        }

        if ($username === '' || strlen($password) < 10) {
            throw new \InvalidArgumentException('Dev install requires a username and password of at least 10 characters.');
        }

        $db = [
            'driver' => 'sqlite',
            'sqlite_path' => $this->paths->defaultSqliteRelativePath(),
        ];

        @mkdir(rtrim($this->paths->dataDir(), '/').'/files', 0775, true);

        $this->database->installFresh(
            $db,
            $username,
            $password,
            'Admin',
            $username.'@localhost',
            true,
            true,
            [
                SettingKeys::TIMEZONE => 'UTC',
                SettingKeys::BASE_URI => '/',
                SettingKeys::AUTH_REALM => 'SabreDAV',
                SettingKeys::BROWSER_PLUGIN => true,
                SettingKeys::FILES_ENABLED => true,
                SettingKeys::CALENDAR_ENABLED => true,
                SettingKeys::CONTACTS_ENABLED => true,
                SettingKeys::TASKS_ENABLED => true,
                SettingKeys::MAIL_ENABLED => false,
                SettingKeys::MAIL_IMAP_HOST => '',
                SettingKeys::MAIL_IMAP_PORT => 993,
                SettingKeys::MAIL_IMAP_SECURITY => '',
                SettingKeys::MAIL_SMTP_HOST => '',
                SettingKeys::MAIL_SMTP_PORT => 587,
                SettingKeys::MAIL_SMTP_SECURITY => '',
                SettingKeys::RTC_STUN_URL => '',
                SettingKeys::RTC_TURN_URL => '',
                SettingKeys::RTC_TURN_USERNAME => '',
                SettingKeys::RTC_TURN_CREDENTIAL => '',
            ],
        );

        $this->jwtKeys->ensureKeys();

        $absDb = $this->paths->resolveProjectPath($db['sqlite_path']);
        $relDb = $this->paths->tryRelativeToInstallRoot($absDb) ?? $db['sqlite_path'];

        $this->envWriter->writeBootstrap([
            'data_dir' => $this->paths->tryRelativeToInstallRoot($this->paths->dataDir()) ?? './wgw-content',
            'pdo' => ['sqlite_file' => $relDb],
        ]);
        WgwRuntimeEnvBridge::apply($this->installConfig);

        if (file_put_contents($this->paths->lockFile(), date('c')."\n", LOCK_EX) === false) {
            throw new \RuntimeException('Database was set up but the install lock file could not be written.');
        }
        @chmod($this->paths->lockFile(), 0600);

        $this->apiEnv->ensure($this->paths->installRoot(), 'http://127.0.0.1:9080');

        return true;
    }
}
