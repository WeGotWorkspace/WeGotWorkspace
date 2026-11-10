<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;
use App\Support\WgwDatabaseProbe;
use Illuminate\Support\Facades\DB;

final class InstallerDatabaseInstaller
{
    public function __construct(
        private AppPaths $paths,
        private InstallerSeeder $seeder,
        private InstallerAppSettingsWriter $settings,
        private WgwSchemaMigrator $schemaMigrator,
        private WgwDatabaseProbe $databaseProbe,
    ) {}

    /**
     * @param  array<string, mixed>  $db
     */
    public function testConnection(array $db): void
    {
        $this->databaseProbe->pingInstallerDb($db);
    }

    /**
     * @param  array<string, mixed>  $db
     */
    public function hasUsers(array $db): bool
    {
        return $this->databaseProbe->installerDbHasUsers($db);
    }

    /**
     * @param  array<string, mixed>  $db
     * @param  array<string, mixed>  $initialSettings
     */
    public function installFresh(
        array $db,
        string $username,
        string $password,
        string $displayName,
        ?string $email,
        bool $enableCalendars,
        bool $enableContacts,
        array $initialSettings,
    ): void {
        if (($db['driver'] ?? '') === 'sqlite') {
            $path = $this->paths->resolveProjectPath((string) ($db['sqlite_path'] ?? $this->paths->defaultSqliteRelativePath()));
            $dir = dirname($path);
            if (! is_dir($dir)) {
                @mkdir($dir, 0775, true);
            }
        }

        $this->databaseProbe->applyInstallerDb($db);

        // Schema migrations run DDL; MySQL implicitly commits and breaks Laravel transactions.
        $this->schemaMigrator->migrate();

        DB::connection('wgw')->transaction(function () use (
            $username,
            $password,
            $displayName,
            $email,
            $enableCalendars,
            $enableContacts,
            $initialSettings,
        ): void {
            $this->seeder->seed($username, $password, $displayName, $email, $enableCalendars, $enableContacts, isAdmin: true);
            $this->settings->replaceMany($initialSettings);
        });
    }
}
