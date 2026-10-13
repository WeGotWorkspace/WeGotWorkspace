<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarRepository;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Docs\DocsThreadCollectionUris;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class CollectionKindInvariantTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->dataDir = storage_path('framework/testing/wgw-kind-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice/docs');
        File::ensureDirectoryExists($this->dataDir.'/files/groups/team/docs');
        WgwTestDisks::refresh($this->dataDir);
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }
        parent::tearDown();
    }

    public function test_every_collection_has_exactly_one_kind(): void
    {
        $this->provisionSurfaces();

        $calendarIds = DB::connection('wgw')->table('calendars')->pluck('id');
        $this->assertNotEmpty($calendarIds);
        foreach ($calendarIds as $calendarId) {
            $this->assertSame(
                1,
                DB::connection('wgw')->table('calendar_collection_meta')->where('calendarid', $calendarId)->count(),
                'calendar '.$calendarId.' must have exactly one kind row',
            );
        }
    }

    public function test_no_stored_kind_contradicts_its_component_set(): void
    {
        $this->provisionSurfaces();

        $rows = DB::connection('wgw')->table('calendar_collection_meta')
            ->join('calendars', 'calendars.id', '=', 'calendar_collection_meta.calendarid')
            ->get(['calendar_collection_meta.kind', 'calendars.components', 'calendars.id']);
        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $kind = CollectionKind::from((string) $row->kind);
            $this->assertTrue(
                $kind->allowsComponents((string) $row->components),
                'calendar '.$row->id.' kind '.$kind->value.' contradicts '.(string) $row->components,
            );
        }
    }

    public function test_provisioned_collections_carry_the_expected_kind(): void
    {
        $channelId = $this->provisionSurfaces();

        $this->assertSame(CollectionKind::Notebook->value, $this->kindFor('principals/alice', CalendarCollectionUris::NOTE_GENERAL));
        $this->assertSame(CollectionKind::TaskList->value, $this->kindFor('principals/alice', InboxTaskListProvisioner::URI));
        $this->assertSame(CollectionKind::EventCalendar->value, $this->kindFor('principals/alice', CalendarCollectionUris::EVENT_DEFAULT));
        $this->assertSame(CollectionKind::ChatChannel->value, $this->kindFor('principals/alice', $channelId));
        $this->assertSame(
            CollectionKind::DocsThreadPool->value,
            $this->kindFor('principals/alice', DocsThreadCollectionUris::POOL_URI),
        );
    }

    private function provisionSurfaces(): string
    {
        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForPrincipal('principals/alice');
        $group = $this->seedWgwGroup('principals/groups/team', 'Team');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($group, $alice);
        $provisioner->ensureForGroupPrincipal((string) $group->uri, 'Team');

        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General',
            'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->postJson('/api/v1/chat/dms', [
            'principal' => 'bob',
        ])->assertOk();
        $this->asUser('alice')->postJson('/api/v1/notes/notebooks', [
            'name' => 'Journal',
        ])->assertCreated();
        app(CalendarRepository::class)->create('alice', ['name' => 'Projects']);
        $this->asUser('alice')->postJson('/api/v1/tasks/tasklists', [
            'name' => 'Errands',
        ])->assertCreated();

        app(WgwStorage::class)->files()->put('users/alice/docs/plan.md', "# Plan\n");
        $this->asUser('alice')->postJson('/api/v1/files/threads?path='.urlencode('/users/alice/docs/plan.md'), [
            'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBF5',
            'kind' => 'comment',
            'body' => 'a thread',
            'anchorText' => 'Plan',
        ])->assertCreated();

        return $channelId;
    }

    private function kindFor(string $principalUri, string $uri): string
    {
        $calendarId = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', $uri)
            ->value('calendarid');
        $this->assertNotNull($calendarId);

        return (string) DB::connection('wgw')->table('calendar_collection_meta')
            ->where('calendarid', $calendarId)
            ->value('kind');
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
