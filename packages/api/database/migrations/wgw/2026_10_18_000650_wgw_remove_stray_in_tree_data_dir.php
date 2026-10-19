<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Installer\StrayDataDirCleaner;

/**
 * A ZIP update runs the new release's migrations from the old release's
 * runner, so this is the one hook that reaches installs made from v0.1.120.
 * Docker runs it through wgw:schema-migrate and a fresh install through
 * installFresh(), after the data directory is resolved.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        // migrate:fresh in PHPUnit must not touch a developer checkout.
        if (app()->environment('testing')) {
            return;
        }

        app(StrayDataDirCleaner::class)->removeIfStray();
    }

    public function down(): void
    {
        // The removed files were generated and unused. Nothing to restore.
    }
};
