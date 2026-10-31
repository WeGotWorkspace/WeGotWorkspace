<?php

declare(strict_types=1);

use App\Database\Migrations\CalendarCollectionMetaTable;
use App\Database\Migrations\WgwMigration;
use App\Services\Calendars\CollectionKind;
use App\Services\Docs\DocsThreadCollectionUris;
use Illuminate\Support\Facades\DB;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars') || ! $this->wgwHasTable('calendarinstances')) {
            return;
        }

        // 2026_07_07_000125 may have created it already. The backfill below
        // keeps the rows the provisioning migrations wrote since then.
        CalendarCollectionMetaTable::ensure($this->wgw());

        $connection = DB::connection('wgw');

        // Rule 1 input: chat owns every calendar that has a chat_channel_meta row.
        $chatCalendarIds = $this->wgwHasTable('chat_channel_meta')
            ? array_flip(array_map(
                static fn ($id): int => (int) $id,
                $connection->table('chat_channel_meta')->pluck('calendarid')->all(),
            ))
            : [];

        // Rule 2 input: the OWNER instance uri only. Sharee instances carry
        // random UUID uris (Sabre updateInvites) and must never decide a kind.
        $ownerUris = [];
        foreach (
            $connection->table('calendarinstances')
                ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
                ->select('calendarid', 'uri')
                ->cursor() as $instance
        ) {
            $ownerUris[(int) $instance->calendarid] = (string) $instance->uri;
        }

        $batch = [];
        foreach ($connection->table('calendars')->select('id', 'components')->orderBy('id')->cursor() as $calendar) {
            $calendarId = (int) $calendar->id;
            $components = (string) ($calendar->components ?? '');
            $ownerUri = $ownerUris[$calendarId] ?? '';

            $kind = match (true) {
                array_key_exists($calendarId, $chatCalendarIds) => CollectionKind::ChatChannel,
                $ownerUri === DocsThreadCollectionUris::POOL_URI => CollectionKind::DocsThreadPool,
                default => CollectionKind::fromComponents($components),
            };

            $batch[] = ['calendarid' => $calendarId, 'kind' => $kind->value];
            if (count($batch) >= 500) {
                $connection->table('calendar_collection_meta')->insertOrIgnore($batch);
                $batch = [];
            }
        }
        if ($batch !== []) {
            $connection->table('calendar_collection_meta')->insertOrIgnore($batch);
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_collection_meta');
    }
};
