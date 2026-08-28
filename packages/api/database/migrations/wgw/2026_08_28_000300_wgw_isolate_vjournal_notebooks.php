<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\EventCalendarJournalStripper;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasTable('calendars')) {
            return;
        }

        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForAllUsers();
        $provisioner->ensureForAllGroups();
        app(EventCalendarJournalStripper::class)->stripAll();
    }

    public function down(): void
    {
        // Data migration — notebooks and stripped component sets remain after rollback.
    }
};
