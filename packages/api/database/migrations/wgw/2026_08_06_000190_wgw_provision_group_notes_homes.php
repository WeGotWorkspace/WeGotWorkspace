<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Notes\GroupNotesHomesProvisioner;

return new class extends WgwMigration
{
    public function up(): void
    {
        app(GroupNotesHomesProvisioner::class)->ensureForAllGroupHomes();
    }

    public function down(): void
    {
        // Data migration — provisioned directories remain after rollback.
    }
};
