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
    public const CURRENT_SCHEMA_VERSION = 37;

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
