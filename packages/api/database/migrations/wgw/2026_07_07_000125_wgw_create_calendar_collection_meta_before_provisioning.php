<?php

declare(strict_types=1);

use App\Database\Migrations\CalendarCollectionMetaTable;
use App\Database\Migrations\WgwMigration;

/**
 * The provisioning migrations from 2026_07_07_000130 on create collections
 * through WgwCalendarBackend, which writes calendar_collection_meta. That
 * table used to arrive only in 2026_10_13_000610, so an install from before
 * 000130 (0.1.70) stopped on "no such table: calendar_collection_meta" and
 * never reached the tables Calendar, Drive and Tasks read (#1076).
 *
 * Pending migrations run in name order, so this one runs before 000130 on
 * those installs. Everywhere else the table exists and this does nothing.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars')) {
            return;
        }

        CalendarCollectionMetaTable::ensure($this->wgw());
    }

    public function down(): void
    {
        // 2026_10_13_000610 owns the table and drops it on rollback.
    }
};
