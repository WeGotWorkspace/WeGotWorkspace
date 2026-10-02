<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Drive\GroupFilesHomeProvisioner;

return new class extends WgwMigration
{
    public function up(): void
    {
        app(GroupFilesHomeProvisioner::class)->ensureForAllGroupPrincipals();
    }

    public function down(): void
    {
        // Data migration — provisioned directories remain after rollback.
    }
};
