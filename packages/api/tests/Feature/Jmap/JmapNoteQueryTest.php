<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Notes\NotebookRepository;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Note/query (#1792): ids for more notes than maxObjectsInGet, so a client
 * can re-list after cannotCalculateChanges with explicit-id Note/get pages.
 */
final class JmapNoteQueryTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
        // Users here share with each other; Epic #1915 only lets colleagues share.
        $this->seedSharedTeamForEveryone();
    }

    public function test_lists_more_notes_than_max_objects_in_get_across_pages(): void
    {
        $count = JmapCapabilities::MAX_OBJECTS_IN_GET + 20;
        $seeded = $this->seedNotes('bob', CalendarCollectionUris::NOTE_GENERAL, $count);

        // The get-all is refused above the cap; that is what the query is for.
        $this->jmap('bob', [['Note/get', ['accountId' => 'bob', 'ids' => null], 'c0']])
            ->assertJsonPath('methodResponses.0.1.type', 'requestTooLarge');

        $collected = [];
        $total = null;
        $queryState = null;
        for ($position = 0; $position < $count; $position += 200) {
            $page = $this->jmap('bob', [
                ['Note/query', ['accountId' => 'bob', 'position' => $position, 'limit' => 200], 'c0'],
            ])->assertOk()->json('methodResponses.0.1');
            $this->assertSame($position, $page['position']);
            $this->assertSame(200, $page['limit']);
            $this->assertFalse($page['canCalculateChanges']);
            $this->assertLessThanOrEqual(200, count($page['ids']));
            $total ??= $page['total'];
            $queryState ??= $page['queryState'];
            $this->assertSame($queryState, $page['queryState']);
            array_push($collected, ...$page['ids']);
        }

        $this->assertSame($count, $total);
        $this->assertSame($seeded, $collected, 'pages list every note once, in a stable order');

        // queryState is the Note/get state, and the ids resolve through Note/get.
        $got = $this->jmap('bob', [
            ['Note/get', ['accountId' => 'bob', 'ids' => array_slice($collected, 0, 25)], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame($queryState, $got['state']);
        $this->assertSame(array_slice($collected, 0, 25), array_column($got['list'], 'id'));
        $this->assertSame([], $got['notFound']);
    }

    public function test_in_notebook_filter_and_default_window(): void
    {
        $work = $this->createNotebook('bob', 'Work');
        $general = $this->createNote('bob', CalendarCollectionUris::NOTE_GENERAL, 'In general');
        $inWork = $this->createNote('bob', $work, 'In work');

        $response = $this->jmap('bob', [
            ['Note/query', ['accountId' => 'bob'], 'c0'],
            ['Note/query', ['accountId' => 'bob', 'filter' => ['inNotebook' => $work]], 'c1'],
            ['Note/query', ['accountId' => 'bob', 'filter' => ['inNotebook' => 'notes-nope']], 'c2'],
            ['Note/query', ['accountId' => 'bob', 'position' => 1, 'limit' => 5], 'c3'],
        ])->assertOk();

        $all = $response->json('methodResponses.0.1');
        $this->assertEqualsCanonicalizing([$general, $inWork], $all['ids']);
        $this->assertSame(2, $all['total']);
        $this->assertSame(0, $all['position']);
        $this->assertArrayNotHasKey('limit', $all);

        $this->assertSame([$inWork], $response->json('methodResponses.1.1.ids'));
        $this->assertSame(1, $response->json('methodResponses.1.1.total'));
        $this->assertSame([], $response->json('methodResponses.2.1.ids'));
        $this->assertSame([$all['ids'][1]], $response->json('methodResponses.3.1.ids'));
        $this->assertSame(2, $response->json('methodResponses.3.1.total'));
    }

    public function test_rejects_sort_unknown_filters_and_bad_arguments(): void
    {
        $response = $this->jmap('bob', [
            ['Note/query', ['accountId' => 'bob', 'sort' => [['property' => 'updated']]], 'c0'],
            ['Note/query', ['accountId' => 'bob', 'filter' => ['text' => 'x']], 'c1'],
            ['Note/query', ['accountId' => 'bob', 'filter' => ['inNotebook' => ['a']]], 'c2'],
            ['Note/query', ['accountId' => 'bob', 'position' => -1], 'c3'],
            ['Note/query', ['accountId' => 'bob', 'limit' => 0], 'c4'],
            ['Note/queryChanges', ['accountId' => 'bob', 'sinceQueryState' => '0:'], 'c5'],
        ])->assertOk();

        $expected = ['unsupportedSort', 'unsupportedFilter', 'invalidArguments', 'invalidArguments', 'invalidArguments', 'cannotCalculateChanges'];
        foreach ($expected as $index => $type) {
            $response->assertJsonPath("methodResponses.{$index}.0", 'error');
            $response->assertJsonPath("methodResponses.{$index}.1.type", $type);
        }
    }

    public function test_sharee_sees_only_shared_notebook_notes_like_note_get(): void
    {
        $shared = $this->createNotebook('bob', 'Shared');
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$shared, [
            'shareWith' => ['alice' => ['mayReadItems' => true]],
        ])->assertOk();
        $sharedNote = $this->createNote('bob', $shared, 'Visible');
        $privateNote = $this->createNote('bob', CalendarCollectionUris::NOTE_GENERAL, 'Private');

        $response = $this->jmap('alice', [
            ['Note/query', ['accountId' => 'alice'], 'c0'],
            ['Note/get', ['accountId' => 'alice', 'ids' => null], 'c1'],
        ])->assertOk();

        $ids = $response->json('methodResponses.0.1.ids');
        $this->assertSame([$sharedNote], $ids);
        $this->assertNotContains($privateNote, $ids);
        $this->assertSame($ids, array_column($response->json('methodResponses.1.1.list'), 'id'));
        $this->assertSame(
            $response->json('methodResponses.1.1.state'),
            $response->json('methodResponses.0.1.queryState'),
        );
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function createNotebook(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/notes/notebooks', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    private function createNote(string $username, string $notebookId, string $title): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/notes/items', ['notebookId' => $notebookId, 'title' => $title, 'body' => 'b'])
            ->assertCreated()
            ->json('id');
    }

    /**
     * Rows go straight into calendarobjects: hundreds of REST creates would
     * dominate the suite runtime for no extra coverage.
     *
     * @return list<string> the seeded note ids, in insert order
     */
    private function seedNotes(string $username, string $notebookId, int $count): array
    {
        $instance = app(NotebookRepository::class)->findAccessibleNotebook($username, $notebookId);
        $this->assertNotNull($instance);
        $ids = [];
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $uid = sprintf('bulk-note-%04d', $i);
            $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:{$uid}\r\nSUMMARY:Bulk {$i}\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
            $ids[] = $uid;
            $rows[] = [
                'calendardata' => $ics,
                'uri' => $uid.'.ics',
                'calendarid' => (int) $instance->calendarid,
                'lastmodified' => time(),
                'etag' => md5($ics),
                'size' => strlen($ics),
                'componenttype' => 'VJOURNAL',
                'uid' => $uid,
            ];
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            CalendarObject::query()->insert($chunk);
        }

        return $ids;
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
