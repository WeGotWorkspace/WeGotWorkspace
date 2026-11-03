<?php

declare(strict_types=1);

namespace Tests\Feature\Search;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\SearchDocument;
use App\Models\User;
use App\Services\Auth\JwtTokenService;
use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Jmap\FileNodes\FileNodeReindexer;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Search\SearchDocumentCollectionBackfill;
use App\Services\Search\SearchIndexerService;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\ConfiguresAppSettings;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Search shows an item only while the caller can still open it. When access
 * ends (share revoked or dismissed, group left, item deleted) its title and
 * snippet leave the results at once, before any reindex.
 */
final class SearchAccessEndsTest extends WgwDatabaseTestCase
{
    use ConfiguresAppSettings;

    private const OWNER = 'carol';

    private const SHAREE = 'member';

    private const GROUP = 'crew';

    private string $dataDir = '';

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->dataDir = storage_path('framework/testing/wgw-search-access-'.uniqid('', true));
        foreach (['users/'.self::OWNER, 'users/'.self::SHAREE, 'groups/'.self::GROUP] as $home) {
            File::ensureDirectoryExists($this->dataDir.'/files/'.$home);
        }
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();

        $this->seedWgwUser(self::OWNER, displayName: 'Carol');
        $this->seedWgwUser(self::SHAREE, displayName: 'Member');
        $member = Principal::forUsername(self::SHAREE);
        $this->assertNotNull($member);
        $this->addPrincipalToGroup($this->seedWgwGroup('principals/groups/'.self::GROUP, 'Crew'), $member);
        $this->setAppSettings([
            WgwSettings::FILES_ENABLED => true,
            WgwSettings::CALENDAR_ENABLED => true,
            WgwSettings::CONTACTS_ENABLED => true,
            WgwSettings::TASKS_ENABLED => true,
            WgwSettings::NOTES_ENABLED => true,
        ]);
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function shareableSources(): iterable
    {
        foreach (['note', 'task', 'event', 'chat'] as $source) {
            yield $source => [$source];
        }
    }

    #[DataProvider('shareableSources')]
    public function test_a_revoked_share_leaves_the_sharees_results_at_once(string $source): void
    {
        $marker = 'zqrevoke'.$source;
        $collection = $this->createCollection($source, $marker);
        $this->share($source, $collection, self::SHAREE, ['mayReadItems' => true]);
        $this->reindex();
        $this->assertNotSame([], $this->hits(self::SHAREE, $marker), 'the sharee finds the item while shared');

        $this->share($source, $collection, self::SHAREE, null);

        $this->assertSame([], $this->hits(self::SHAREE, $marker));
        $this->assertNotSame([], $this->hits(self::OWNER, $marker), 'the owner still finds the item');
    }

    #[DataProvider('shareableSources')]
    public function test_a_dismissed_share_leaves_the_sharees_results_and_content(string $source): void
    {
        $marker = 'zqdismiss'.$source;
        $collection = $this->createCollection($source, $marker);
        $this->share($source, $collection, self::SHAREE, ['mayReadItems' => true]);
        $this->reindex();
        $before = $this->hits(self::SHAREE, $marker);
        $this->assertNotSame([], $before);

        $this->dismissAsSharee($source, $marker);

        $this->assertSame([], $this->hits(self::SHAREE, $marker));
        foreach ($before as $hit) {
            $this->as(self::SHAREE, 'GET', '/search/results/lookup/content?'.http_build_query([
                'source_type' => $hit['sourceType'],
                'source_key' => $hit['sourceKey'],
            ]))->assertNotFound();
        }
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function groupShareableSources(): iterable
    {
        foreach (['note', 'task', 'event'] as $source) {
            yield $source => [$source];
        }
    }

    #[DataProvider('groupShareableSources')]
    public function test_a_revoked_group_share_leaves_every_members_results(string $source): void
    {
        $marker = 'zqgroupshare'.$source;
        $collection = $this->createCollection($source, $marker);
        $this->share($source, $collection, 'groups/'.self::GROUP, ['mayReadItems' => true]);
        $this->reindex();
        $this->assertNotSame([], $this->hits(self::SHAREE, $marker));

        $this->share($source, $collection, 'groups/'.self::GROUP, null);

        $this->assertSame([], $this->hits(self::SHAREE, $marker));
    }

    public function test_leaving_a_group_drops_every_group_source_from_results(): void
    {
        $marker = 'zqformergroup';
        foreach (['note', 'task', 'event', 'chat'] as $source) {
            $this->createCollection($source, $marker, self::GROUP, self::SHAREE);
        }
        $this->createGroupContact($marker);
        app(WgwStorage::class)->files()->put('groups/'.self::GROUP.'/'.$marker.'-file.md', '# '.$marker." file\n");
        $docPath = '/groups/'.self::GROUP.'/'.$marker.'-doc.md';
        app(WgwStorage::class)->files()->put(ltrim($docPath, '/'), "# Doc\n\nBody\n");
        $this->reindex();
        $this->as(self::SHAREE, 'POST', '/files/threads?path='.urlencode($docPath), [
            'id' => (string) Str::ulid(), 'kind' => 'comment', 'body' => $marker.' thread comment', 'anchorText' => 'Doc',
        ])->assertCreated();
        $this->reindex();
        $types = array_unique(array_column($this->hits(self::SHAREE, $marker), 'sourceType'));
        sort($types);
        $this->assertSame(['caldav', 'carddav', 'file'], $types, 'the member finds every group source');

        GroupMember::query()
            ->where('principal_id', Principal::query()->where('uri', 'principals/groups/'.self::GROUP)->value('id'))
            ->where('member_id', Principal::forUsername(self::SHAREE)?->id)
            ->delete();

        $this->assertSame([], $this->hits(self::SHAREE, $marker));
    }

    public function test_a_shared_item_the_owner_deletes_leaves_the_sharees_results(): void
    {
        $marker = 'zqdeleted';
        $listId = $this->createCollection('task', $marker);
        $this->share('task', $listId, self::SHAREE, ['mayReadItems' => true]);
        $this->reindex();
        $this->assertNotSame([], $this->hits(self::SHAREE, $marker));

        $taskId = (string) $this->findId($this->as(self::OWNER, 'GET', '/tasks/items?'.http_build_query(['taskListId' => $listId]))->json(), $marker.' task', 'title');
        $url = '/tasks/items/'.rawurlencode($taskId);
        $etag = (string) $this->as(self::OWNER, 'GET', $url)->assertOk()->json('etag');
        $this->as(self::OWNER, 'DELETE', $url, headers: ['If-Match' => $etag])->assertSuccessful();

        $this->assertSame([], $this->hits(self::SHAREE, $marker));
    }

    public function test_a_revoked_drive_or_address_book_share_never_surfaces_the_owners_items(): void
    {
        $marker = 'zqdriveshare';
        $docPath = '/users/'.self::OWNER.'/'.$marker.'-doc.md';
        app(WgwStorage::class)->files()->put(ltrim($docPath, '/'), '# '.$marker." doc\n\nBody\n");
        $this->reindex();
        $shareId = (string) $this->as(self::OWNER, 'POST', '/files/shares', [
            'path' => $docPath, 'kind' => 'member', 'defaultAccess' => 'view',
            'shareWith' => [self::SHAREE => ['access' => 'edit']],
        ])->assertOk()->json('data.id');
        $this->as(self::OWNER, 'POST', '/files/threads?path='.urlencode($docPath), [
            'id' => (string) Str::ulid(), 'kind' => 'comment', 'body' => $marker.' thread comment', 'anchorText' => 'Doc',
        ])->assertCreated();
        app(AddressBookProvisioner::class)->ensureForPrincipal('principals/'.self::OWNER, 'Carol');
        $this->jmap(self::OWNER, JmapCapabilities::CONTACTS, [
            ['ContactCard/set', ['accountId' => self::OWNER, 'create' => ['k' => [
                'addressBookIds' => ['default' => true], 'name' => ['full' => $marker.' contact'],
            ]]], 'c0'],
        ]);
        $this->jmap(self::OWNER, JmapCapabilities::CONTACTS, [
            ['AddressBook/set', ['accountId' => self::OWNER, 'update' => ['default' => ['shareWith' => [self::SHAREE => ['mayRead' => true]]]]], 'c0'],
        ]);
        $this->reindex();

        $this->as(self::OWNER, 'DELETE', '/files/shares/'.$shareId)->assertOk();
        $this->jmap(self::OWNER, JmapCapabilities::CONTACTS, [
            ['AddressBook/set', ['accountId' => self::OWNER, 'update' => ['default' => ['shareWith' => null]]], 'c0'],
        ]);

        $this->assertSame([], $this->hits(self::SHAREE, $marker));
        $this->assertCount(3, $this->hits(self::OWNER, $marker), 'doc, thread and contact stay findable for the owner');
    }

    public function test_the_backfill_links_existing_rows_and_keeps_rows_of_ended_shares_hidden(): void
    {
        $marker = 'zqbackfill';
        $listId = $this->createCollection('task', $marker);
        $this->share('task', $listId, self::SHAREE, ['mayReadItems' => true]);
        $this->createGroupContact($marker);
        $this->reindex();
        $this->share('task', $listId, self::SHAREE, null);
        // Rows as indexed before collection ids existed.
        SearchDocument::query()->whereIn('source_type', ['caldav', 'carddav'])->update(['collection_id' => null, 'object_id' => null]);
        $this->assertSame([], $this->hits(self::OWNER, $marker), 'unlinked rows stay hidden');

        app(SearchDocumentCollectionBackfill::class)->run();

        $this->assertCount(1, $this->hits(self::OWNER, $marker), 'the owner finds the task again');
        $this->assertSame(['carddav'], array_column($this->hits(self::SHAREE, $marker), 'sourceType'), 'only the group contact, not the revoked task');
    }

    /**
     * Creates a collection holding one item titled "<marker> <source>" and
     * returns the collection id.
     */
    private function createCollection(string $source, string $marker, ?string $group = null, ?string $creator = null): string
    {
        $creator ??= self::OWNER;
        $groupPayload = $group === null ? [] : ['groupSlug' => $group];

        switch ($source) {
            case 'note':
                $id = (string) $this->as($creator, 'POST', '/notes/notebooks', ['name' => $marker.' notebook'] + $groupPayload)->assertCreated()->json('id');
                $this->as($creator, 'POST', '/notes/items', ['notebookId' => $id, 'title' => $marker.' note', 'body' => $marker.' note body'])->assertCreated();

                return $id;
            case 'task':
                $id = (string) $this->as($creator, 'POST', '/tasks/tasklists', ['name' => $marker.' list'] + $groupPayload)->assertCreated()->json('id');
                $this->as($creator, 'POST', '/tasks/items', ['taskListIds' => [$id => true], 'title' => $marker.' task'])->assertCreated();

                return $id;
            case 'chat':
                $id = (string) $this->as($creator, 'POST', '/chat/channels', ['name' => $marker.' channel', 'kind' => 'channel'] + $groupPayload)->assertCreated()->json('id');
                $this->as($creator, 'POST', '/chat/channels/'.$id.'/messages', ['id' => (string) Str::ulid(), 'body' => $marker.' chat message'])->assertCreated();

                return $id;
            default:
                $id = (string) $this->jmap($creator, JmapCapabilities::CALENDARS, [
                    ['Calendar/set', ['accountId' => $creator, 'create' => ['c' => ['name' => $marker.' calendar'] + $groupPayload]], 'c0'],
                ])->json('methodResponses.0.1.created.c.id');
                $this->jmap($creator, JmapCapabilities::CALENDARS, [
                    ['CalendarEvent/set', ['accountId' => $creator, 'create' => ['e' => [
                        'calendarIds' => [$id => true],
                        'title' => $marker.' event',
                        'start' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+2 days 14:00 UTC')),
                        'end' => gmdate('Y-m-d\TH:i:s\Z', strtotime('+2 days 15:00 UTC')),
                    ]]], 'c0'],
                ])->assertJsonStructure(['methodResponses' => [['1' => ['created' => ['e' => ['id']]]]]]);

                return $id;
        }
    }

    /**
     * @param  array<string, bool>|null  $rights  null revokes
     */
    private function share(string $source, string $collectionId, string $sharee, ?array $rights): void
    {
        if ($source === 'event') {
            $response = $this->jmap(self::OWNER, JmapCapabilities::CALENDARS, [
                ['Calendar/set', ['accountId' => self::OWNER, 'update' => [$collectionId => ['shareWith' => [$sharee => $rights]]]], 'c0'],
            ]);
            $this->assertEmpty($response->json('methodResponses.0.1.notUpdated'));

            return;
        }

        $uri = match ($source) {
            'note' => '/notes/notebooks/',
            'task' => '/tasks/tasklists/',
            default => '/chat/channels/',
        };
        $this->as(self::OWNER, 'PATCH', $uri.$collectionId, ['shareWith' => [$sharee => $rights]])->assertOk();
    }

    private function dismissAsSharee(string $source, string $marker): void
    {
        if ($source === 'event') {
            $calendars = $this->jmap(self::SHAREE, JmapCapabilities::CALENDARS, [
                ['Calendar/get', ['accountId' => self::SHAREE, 'ids' => null], 'c0'],
            ])->json('methodResponses.0.1.list');
            $id = (string) $this->findId($calendars, $marker.' calendar');
            $this->jmap(self::SHAREE, JmapCapabilities::CALENDARS, [
                ['Calendar/set', ['accountId' => self::SHAREE, 'destroy' => [$id]], 'c0'],
            ])->assertJsonPath('methodResponses.0.1.destroyed', [$id]);

            return;
        }

        [$uri, $name] = match ($source) {
            'note' => ['/notes/notebooks', $marker.' notebook'],
            'task' => ['/tasks/tasklists', $marker.' list'],
            default => ['/chat/channels', $marker.' channel'],
        };
        $id = (string) $this->findId($this->as(self::SHAREE, 'GET', $uri)->assertOk()->json(), $name);
        $this->as(self::SHAREE, 'DELETE', $uri.'/'.rawurlencode($id))->assertSuccessful();
    }

    private function createGroupContact(string $marker): void
    {
        app(AddressBookProvisioner::class)->ensureForGroupPrincipal('principals/groups/'.self::GROUP, 'Crew');
        $this->jmap(self::SHAREE, JmapCapabilities::CONTACTS, [
            ['ContactCard/set', ['accountId' => self::SHAREE, 'create' => ['k' => [
                'addressBookIds' => ['group-'.self::GROUP => true],
                'name' => ['full' => $marker.' contact'],
            ]]], 'c0'],
        ])->assertJsonStructure(['methodResponses' => [['1' => ['created' => ['k' => ['id']]]]]]);
    }

    /**
     * The id of the first object in a JSON tree whose `$field` equals `$value`.
     */
    private function findId(mixed $tree, string $value, string $field = 'name'): ?string
    {
        if (! is_array($tree)) {
            return null;
        }
        if (($tree[$field] ?? null) === $value && isset($tree['id'])) {
            return (string) $tree['id'];
        }
        foreach ($tree as $child) {
            $found = $this->findId($child, $value, $field);
            if ($found !== null) {
                return $found;
            }
        }

        return null;
    }

    /** The full reindex an admin search job runs. */
    private function reindex(): void
    {
        app(FileNodeReindexer::class)->reindexAll();
        app(SearchIndexerService::class)->reindexAllFromFileNodes();
    }

    /**
     * Results whose title or snippet carries the marker.
     *
     * @return list<array<string, mixed>>
     */
    private function hits(string $username, string $marker): array
    {
        $results = (array) $this->as($username, 'GET', '/search/results?'.http_build_query(['q' => $marker, 'limit' => 100]))
            ->assertOk()
            ->json('data.results');

        return array_values(array_filter($results, static fn (array $row): bool => str_contains(
            strtolower(((string) ($row['title'] ?? '')).' '.((string) ($row['snippet'] ?? ''))),
            $marker,
        )));
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, string $capability, array $methodCalls): TestResponse
    {
        return $this->as($username, 'POST', '/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $methodCalls,
        ])->assertOk();
    }

    /**
     * @param  array<string, mixed>  $data
     * @param  array<string, string>  $headers
     */
    private function as(string $username, string $method, string $uri, array $data = [], array $headers = []): TestResponse
    {
        $this->tokens[$username] ??= app(JwtTokenService::class)->issue([
            'sub' => $username,
            'role' => 'user',
            'exp' => time() + 3600,
            'uid' => (int) User::query()->where('username', $username)->value('id'),
        ]);

        return $this->json($method, '/api/v1'.$uri, $data, ['Authorization' => 'Bearer '.$this->tokens[$username]] + $headers);
    }
}
