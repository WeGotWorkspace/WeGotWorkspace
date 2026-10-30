<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Notes\EventCalendarJournalStripper;

/**
 * Installs updated before #1772 ran the old default-calendar migration,
 * which left the default calendar VEVENT-only, so the VJOURNAL isolation
 * skipped it and CalDAV notes stayed out of Notes' sight (#1779).
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars') || ! $this->wgwHasTable('calendarobjects')) {
            return;
        }

        app(EventCalendarJournalStripper::class)->repairStranded();
    }

    public function down(): void
    {
        // Data migration — moved notes stay in their notebook after rollback.
    }
};
