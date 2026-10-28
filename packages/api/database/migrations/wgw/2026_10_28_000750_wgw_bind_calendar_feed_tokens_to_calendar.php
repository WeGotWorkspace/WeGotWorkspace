<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Calendars\CalendarRepository;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * A published feed belongs to the calendar, not to the member who published it.
 *
 * Tokens were keyed by (owner_username, calendar_uri) and resolved by uri at
 * request time. This binds each token to Sabre `calendars.id` instead, with
 * ON DELETE CASCADE, so a token dies with its calendar on every delete path
 * (REST, CalDAV, user and group delete).
 *
 * Each existing token is mapped to the calendar it resolves to today (the
 * publisher's personal calendar first, then their groups, the same lookup the
 * public feed used). A token that resolves to nothing is dropped. Several
 * tokens of one calendar all keep working, so calendarid is indexed, not unique;
 * the service creates at most one new feed per calendar.
 */
return new class extends WgwMigration
{
    private const TABLE = 'calendar_feed_tokens';

    public function up(): void
    {
        if (! $this->wgwHasTable(self::TABLE) || ! $this->wgwHasTable('calendars')) {
            return;
        }

        if (! $this->wgwHasColumn(self::TABLE, 'calendarid')) {
            $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
                $table->unsignedInteger('calendarid')->nullable();
            });
        }

        if ($this->wgwHasColumn(self::TABLE, 'owner_username')) {
            $this->backfillCalendarIds();
            $this->dropPublisherColumns();
        }

        if (! $this->hasCalendarForeignKey()) {
            $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
                $table->unsignedInteger('calendarid')->nullable(false)->change();
                $table->index('calendarid');
                $table->foreign('calendarid')
                    ->references('id')
                    ->on('calendars')
                    ->onDelete('cascade');
            });
        }
    }

    /**
     * Restores the publisher columns for personal calendar feeds. A group
     * calendar feed has no single publisher to restore, so it is removed, as
     * are extra feeds of one calendar beyond the oldest.
     */
    public function down(): void
    {
        if (! $this->wgwHasTable(self::TABLE) || ! $this->wgwHasColumn(self::TABLE, 'calendarid')) {
            return;
        }

        $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
            $table->string('owner_username', 255)->nullable();
            $table->string('calendar_uri', 255)->nullable();
        });

        $connection = DB::connection('wgw');
        $seen = [];
        foreach ($connection->table(self::TABLE)->orderBy('id')->get(['id', 'calendarid']) as $row) {
            $calendarId = (int) $row->calendarid;
            $owner = isset($seen[$calendarId]) ? null : $this->personalOwner($calendarId);
            if ($owner === null) {
                $connection->table(self::TABLE)->where('id', $row->id)->delete();

                continue;
            }
            $seen[$calendarId] = true;
            $connection->table(self::TABLE)->where('id', $row->id)->update([
                'owner_username' => $owner['username'],
                'calendar_uri' => $owner['uri'],
            ]);
        }

        $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
            $table->dropForeign(['calendarid']);
            $table->dropIndex(['calendarid']);
        });
        $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
            $table->dropColumn('calendarid');
        });
        $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
            $table->string('owner_username', 255)->nullable(false)->change();
            $table->string('calendar_uri', 255)->nullable(false)->change();
            $table->unique(['owner_username', 'calendar_uri']);
            $table->index('owner_username');
        });
    }

    /**
     * @return array{username: string, uri: string}|null
     */
    private function personalOwner(int $calendarId): ?array
    {
        $owner = DB::connection('wgw')->table('calendarinstances')
            ->where('calendarid', $calendarId)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->first(['principaluri', 'uri']);
        if ($owner === null) {
            return null;
        }
        $principalUri = (string) $owner->principaluri;
        if (preg_match('#^principals/([^/]+)$#', $principalUri, $matches) !== 1) {
            return null;
        }

        return ['username' => $matches[1], 'uri' => (string) $owner->uri];
    }

    private function backfillCalendarIds(): void
    {
        $connection = DB::connection('wgw');
        $calendars = app(CalendarRepository::class);
        $rows = $connection->table(self::TABLE)
            ->whereNull('calendarid')
            ->get(['id', 'owner_username', 'calendar_uri']);

        foreach ($rows as $row) {
            $instance = $calendars->findAccessibleCalendar(
                (string) $row->owner_username,
                (string) $row->calendar_uri,
            );
            if ($instance === null) {
                $connection->table(self::TABLE)->where('id', $row->id)->delete();

                continue;
            }
            $connection->table(self::TABLE)->where('id', $row->id)->update([
                'calendarid' => (int) $instance->calendarid,
            ]);
        }
    }

    private function dropPublisherColumns(): void
    {
        $indexes = array_map(
            static fn (array $index): string => (string) $index['name'],
            $this->wgw()->getIndexes(self::TABLE),
        );
        $this->wgw()->table(self::TABLE, function (Blueprint $table) use ($indexes): void {
            if (in_array('calendar_feed_tokens_owner_username_calendar_uri_unique', $indexes, true)) {
                $table->dropUnique(['owner_username', 'calendar_uri']);
            }
            if (in_array('calendar_feed_tokens_owner_username_index', $indexes, true)) {
                $table->dropIndex(['owner_username']);
            }
        });
        $this->wgw()->table(self::TABLE, function (Blueprint $table): void {
            $table->dropColumn(['owner_username', 'calendar_uri']);
        });
    }

    private function hasCalendarForeignKey(): bool
    {
        foreach ($this->wgw()->getForeignKeys(self::TABLE) as $foreignKey) {
            if ($foreignKey['columns'] === ['calendarid']) {
                return true;
            }
        }

        return false;
    }
};
