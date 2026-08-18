<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Calendars\DefaultCalendarColorMigrator;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendarinstances')) {
            return;
        }

        app(DefaultCalendarColorMigrator::class)->migrateAll();
    }

    public function down(): void
    {
        // Data migration — assigned colors remain after rollback.
    }
};
