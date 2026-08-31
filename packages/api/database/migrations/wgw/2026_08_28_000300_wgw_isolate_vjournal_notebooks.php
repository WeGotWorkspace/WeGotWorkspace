<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\EventCalendarJournalStripper;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasTable('calendars')) {
            return;
        }

        // UNIQUE (calendarid, uid) must exist before VJOURNAL strip/move so a
        // colliding UID cannot leave the schema straddling this migration.
        $this->ensureCalendarObjectUidUnique();

        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForAllUsers();
        $provisioner->ensureForAllGroups();
        app(EventCalendarJournalStripper::class)->stripAll();
    }

    private function ensureCalendarObjectUidUnique(): void
    {
        if (! $this->wgwHasTable('calendarobjects')) {
            return;
        }

        $duplicates = DB::connection('wgw')->table('calendarobjects')
            ->select('calendarid', 'uid', DB::raw('COUNT(*) as total'))
            ->whereNotNull('uid')
            ->where('uid', '!=', '')
            ->groupBy('calendarid', 'uid')
            ->having('total', '>', 1)
            ->get();

        if ($duplicates->isNotEmpty()) {
            $report = $duplicates->map(
                static fn ($row): string => sprintf('calendarid=%s uid=%s count=%s', $row->calendarid, $row->uid, $row->total)
            )->implode('; ');
            throw new RuntimeException('Duplicate (calendarid, uid) rows block UNIQUE calendarid_uid: '.$report);
        }

        $this->wgw()->table('calendarobjects', function (Blueprint $table): void {
            $indexes = collect($this->wgw()->getIndexes('calendarobjects'))->pluck('name')->all();
            if (! in_array('calendarid_uid', $indexes, true)) {
                $table->unique(['calendarid', 'uid'], 'calendarid_uid');
            }
        });
    }

    public function down(): void
    {
        // Data migration — notebooks and stripped component sets remain after rollback.
    }
};
