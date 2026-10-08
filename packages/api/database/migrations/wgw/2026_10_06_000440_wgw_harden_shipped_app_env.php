<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Update\ShippedInstallEnvHardening;

return new class extends WgwMigration
{
    public function up(): void
    {
        // migrate:fresh in PHPUnit must not rewrite a developer checkout.
        if (app()->environment('testing')) {
            return;
        }

        app(ShippedInstallEnvHardening::class)->apply();
    }

    public function down(): void
    {
        // One-time production hardening. Do not restore local or debug.
    }
};
