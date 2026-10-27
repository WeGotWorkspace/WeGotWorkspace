<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Note UIDs are looked up across every notebook (create, move, room access).
 * The `calendarid_uid` unique index leads with `calendarid`, so a lookup by
 * UID alone scanned the table, and the locking read in a note create held
 * every row it scanned on MySQL. This index makes it a lookup and a narrow
 * lock.
 */
return new class extends WgwMigration
{
    private const INDEX = 'calendarobjects_uid_componenttype';

    public function up(): void
    {
        if (! $this->wgwHasTable('calendarobjects') || $this->hasIndex()) {
            return;
        }

        $this->wgw()->table('calendarobjects', function (Blueprint $table): void {
            $table->index(['uid', 'componenttype'], self::INDEX);
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('calendarobjects') || ! $this->hasIndex()) {
            return;
        }

        $this->wgw()->table('calendarobjects', function (Blueprint $table): void {
            $table->dropIndex(self::INDEX);
        });
    }

    private function hasIndex(): bool
    {
        return in_array(self::INDEX, collect($this->wgw()->getIndexes('calendarobjects'))->pluck('name')->all(), true);
    }
};
