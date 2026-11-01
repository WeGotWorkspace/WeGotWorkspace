<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Models\AppMigration;
use App\Support\WgwConnectionConfigurator;
use Illuminate\Database\Migrations\Migrator;
use Illuminate\Support\Facades\Schema;

final class WgwSchemaMigrator
{
    /** Number of baseline migrations in {@see migrationsPath()}. */
    public const CURRENT_SCHEMA_VERSION = 78;

    public function migrate(): void
    {
        $migrator = $this->migrator();
        $migrator->setConnection('wgw');

        $repository = $migrator->getRepository();
        if (! $repository->repositoryExists()) {
            $repository->createRepository();
        }

        $migrator->run([$this->migrationsPath()]);
    }

    public function migratePdo(\PDO $pdo): int
    {
        WgwConnectionConfigurator::applyFromPdo($pdo);
        $this->migrate();

        return $this->currentVersion();
    }

    public function currentVersion(): int
    {
        $migrator = $this->migrator();
        $migrator->setConnection('wgw');
        $repository = $migrator->getRepository();
        if (! $repository->repositoryExists()) {
            return $this->legacyAppMigrationVersion();
        }

        return count($repository->getRan());
    }

    /**
     * Migrations on disk that the repository has not run. Empty when the
     * repository table does not exist yet: that is a fresh or pre-migrator
     * install, not an update that stopped halfway.
     *
     * @return list<string>
     */
    public function pendingMigrations(): array
    {
        $migrator = $this->migrator();
        $migrator->setConnection('wgw');
        $repository = $migrator->getRepository();
        if (! $repository->repositoryExists()) {
            return [];
        }

        $files = array_keys($migrator->getMigrationFiles([$this->migrationsPath()]));

        return array_values(array_diff($files, $repository->getRan()));
    }

    /**
     * Hash of the migration file names on disk. It changes whenever an update
     * adds or removes a migration, without touching the database.
     */
    public function migrationSetSignature(): string
    {
        $names = array_map(
            static fn (string $path): string => basename($path, '.php'),
            glob($this->migrationsPath().'/*.php') ?: [],
        );
        sort($names);

        return hash('sha256', implode("\n", $names));
    }

    public function migrationsPath(): string
    {
        return database_path('migrations/wgw');
    }

    private function migrator(): Migrator
    {
        return app('migrator');
    }

    private function legacyAppMigrationVersion(): int
    {
        if (! Schema::connection('wgw')->hasTable('app_migrations')) {
            return 0;
        }

        return AppMigration::legacyMaxVersion();
    }
}
