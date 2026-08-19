<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Tasks\InboxTaskListProvisioner;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasTable('calendarinstances')) {
            return;
        }

        app(InboxTaskListProvisioner::class)->ensureForAllUsers();
    }

    public function down(): void
    {
        // Data migration — tasks-inbox URIs remain after rollback.
    }
};
