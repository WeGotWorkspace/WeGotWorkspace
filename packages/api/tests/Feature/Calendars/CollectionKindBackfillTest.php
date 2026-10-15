<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Services\Calendars\CollectionKind;
use Illuminate\Support\Facades\DB;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Backfill classifies each calendar once, from the owner instance and
 * chat_channel_meta. A sharee UUID uri must not decide the kind.
 */
final class CollectionKindBackfillTest extends WgwDatabaseTestCase
{
    public function test_backfill_assigns_one_kind_per_family_and_ignores_sharee_uris(): void
    {
        $connection = DB::connection('wgw');
        $ids = [];
        foreach ([
            'event' => 'VEVENT',
            'task' => 'VTODO',
            'notebook' => 'VJOURNAL',
            'mixed' => 'VEVENT,VTODO',
            'pool' => 'VJOURNAL',
            'chat' => 'VJOURNAL',
        ] as $key => $components) {
            $ids[$key] = (int) $connection->table('calendars')->insertGetId([
                'synctoken' => 1,
                'components' => $components,
            ]);
        }

        $this->ownerInstance($ids['event'], 'principals/alice', 'default');
        $this->ownerInstance($ids['task'], 'principals/alice', 'tasks-inbox');
        $this->ownerInstance($ids['notebook'], 'principals/alice', 'shared-notes');
        $this->shareeInstance($ids['notebook'], 'principals/bob', '11111111-2222-4333-8444-555555555555');
        $this->ownerInstance($ids['mixed'], 'principals/alice', 'legacy-mixed');
        $this->ownerInstance($ids['pool'], 'principals/alice', 'docs-threads');
        $this->shareeInstance($ids['pool'], 'principals/bob', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
        $this->ownerInstance($ids['chat'], 'principals/alice', 'chat-general');
        $connection->table('chat_channel_meta')->insert([
            'calendarid' => $ids['chat'],
            'kind' => 'channel',
        ]);

        $migration = require database_path('migrations/wgw/2026_10_13_000610_wgw_create_calendar_collection_meta.php');
        $migration->up();

        $this->assertSame(CollectionKind::EventCalendar->value, $this->kind($ids['event']));
        $this->assertSame(CollectionKind::TaskList->value, $this->kind($ids['task']));
        $this->assertSame(CollectionKind::Notebook->value, $this->kind($ids['notebook']));
        $this->assertSame(CollectionKind::EventCalendar->value, $this->kind($ids['mixed']));
        $this->assertSame(CollectionKind::DocsThreadPool->value, $this->kind($ids['pool']));
        $this->assertSame(CollectionKind::ChatChannel->value, $this->kind($ids['chat']));

        $this->assertSame(
            1,
            $connection->table('calendar_collection_meta')->where('calendarid', $ids['notebook'])->count(),
        );
        $this->assertNotSame(
            CollectionKind::DocsThreadPool->value,
            $this->kind($ids['notebook']),
        );
    }

    private function ownerInstance(int $calendarId, string $principalUri, string $uri): void
    {
        DB::connection('wgw')->table('calendarinstances')->insert([
            'calendarid' => $calendarId,
            'principaluri' => $principalUri,
            'access' => SharingPlugin::ACCESS_SHAREDOWNER,
            'displayname' => $uri,
            'uri' => $uri,
            'transparent' => 0,
        ]);
    }

    private function shareeInstance(int $calendarId, string $principalUri, string $uri): void
    {
        DB::connection('wgw')->table('calendarinstances')->insert([
            'calendarid' => $calendarId,
            'principaluri' => $principalUri,
            'access' => SharingPlugin::ACCESS_READWRITE,
            'displayname' => $uri,
            'uri' => $uri,
            'transparent' => 0,
        ]);
    }

    private function kind(int $calendarId): string
    {
        return (string) DB::connection('wgw')->table('calendar_collection_meta')
            ->where('calendarid', $calendarId)
            ->value('kind');
    }
}
