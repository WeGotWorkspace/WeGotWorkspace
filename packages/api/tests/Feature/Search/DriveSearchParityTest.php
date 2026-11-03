<?php

declare(strict_types=1);

namespace Tests\Feature\Search;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeReindexer;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Search\SearchIndexerService;
use App\Services\Search\SearchReindexRunner;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Drive lists `jmap_file_nodes`; Docs home and search read `search_documents`.
 * A markdown file must not be able to land in one index without the other.
 */
final class DriveSearchParityTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use SendsFramedCollaboration;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls, ?string $token = null): TestResponse
    {
        return $this->withBearer($token ?? $this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function uploadBlob(string $contents, string $type = 'text/plain'): string
    {
        return (string) $this->call(
            'POST',
            '/api/v1/jmap/upload/bob',
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.$this->userBearerToken(),
                'Content-Type' => $type,
            ]),
            content: $contents,
        )->json('blobId');
    }

    public function test_jmap_create_of_markdown_is_browse_visible_in_docs_home(): void
    {
        $nodes = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $homeId = null;
        foreach ($nodes as $node) {
            if ($node['name'] === 'bob' && $node['parentId'] === null) {
                $homeId = $node['id'];
                break;
            }
        }
        $this->assertNotNull($homeId);

        $blobId = $this->uploadBlob("# Hello\n", 'text/markdown');
        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'f0' => ['parentId' => $homeId, 'name' => 'Untitled.md', 'blobId' => $blobId],
            ]], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.created.f0.name', 'Untitled.md');

        $this->withBearer($this->userBearerToken())
            ->get('/api/v1/search/results?'.http_build_query([
                'sources' => ['file'],
                'extensions' => ['md', 'markdown', 'txt'],
                'categories' => ['document'],
                'limit' => 50,
            ]))
            ->assertOk()
            ->assertJsonFragment([
                'sourceKey' => 'users/bob/Untitled.md',
                'title' => 'Untitled.md',
                'extension' => 'md',
                'category' => 'document',
            ]);
    }

    public function test_file_discovered_by_reconcile_is_search_indexed(): void
    {
        $user = 'bob';
        app(WgwStorage::class)->files()->put("users/{$user}/Discovered.md", "# Discovered\n");

        $rootIds = $this->jmap([
            ['FileNode/query', ['accountId' => $user, 'filter' => ['isTopLevel' => true]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertIsArray($rootIds);

        $roots = $this->jmap([
            ['FileNode/get', ['accountId' => $user, 'ids' => $rootIds], 'c1'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $homeId = null;
        foreach ($roots as $node) {
            if ($node['name'] === $user) {
                $homeId = $node['id'];
                break;
            }
        }
        $this->assertNotNull($homeId);

        $this->jmap([
            ['FileNode/query', ['accountId' => $user, 'filter' => ['parentId' => $homeId]], 'c2'],
        ])->assertOk();

        $this->assertNotNull(
            JmapFileNode::query()
                ->where('storage_key', "users/{$user}/Discovered.md")
                ->whereNull('deleted_at')
                ->first(),
        );

        $row = DB::connection('wgw')->table('search_documents')
            ->where('source_key', "users/{$user}/Discovered.md")
            ->first();
        $this->assertNotNull($row);
        $this->assertSame('md', $row->extension);
        $this->assertSame('document', $row->category);
        $this->assertSame($user, $row->owner_username);
    }

    public function test_every_live_file_node_has_a_search_document_after_reindex(): void
    {
        $user = 'bob';
        $disk = app(WgwStorage::class)->files();
        $disk->put("users/{$user}/A.md", "# A\n");
        $disk->put("users/{$user}/sub/B.md", "# B\n");
        $disk->put("users/{$user}/.Trash/C.md", "# C\n");

        // Product reindex: file-index backfill, then SearchIndexerService::reindexAllFromFileNodes().
        app(SearchReindexRunner::class)->run();
        app(SearchIndexerService::class)->reindexAllFromFileNodes();

        foreach (["users/{$user}/A.md", "users/{$user}/sub/B.md", "users/{$user}/.Trash/C.md"] as $key) {
            $this->assertNotNull(
                JmapFileNode::query()->where('storage_key', $key)->whereNull('deleted_at')->first(),
                "Expected a live file node for {$key}",
            );
        }

        $live = JmapFileNode::query()->whereNull('deleted_at')->orderBy('storage_key')->get();
        $this->assertNotEmpty($live);
        foreach ($live as $node) {
            $key = (string) $node->storage_key;
            if ($this->keyIsTrashOrAttachment($key)) {
                $this->assertSearchDocumentMissing($key);

                continue;
            }
            $this->assertSearchDocumentExists($key);
        }

        $this->assertSearchDocumentMissing("users/{$user}/.Trash/C.md");
        $this->assertNoSearchDocumentsWithoutALiveFileNode();
    }

    public function test_reindex_drops_a_search_row_whose_file_was_removed(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/gone.md', "# Gone\n");
        app(SearchReindexRunner::class)->run();
        $this->assertSearchDocumentExists('users/bob/gone.md');
        $this->insertSearchDocument('caldav', 'bob|default|missing.ics');

        $disk->delete('users/bob/gone.md');
        app(SearchReindexRunner::class)->run();

        $this->assertNotNull(
            JmapFileNode::query()
                ->where('storage_key', 'users/bob/gone.md')
                ->whereNotNull('deleted_at')
                ->first(),
        );
        $this->assertSearchDocumentMissing('users/bob/gone.md');
        $this->assertNull($this->searchDocument('caldav', 'bob|default|missing.ics'));
        $this->assertNoSearchDocumentsWithoutALiveFileNode();
    }

    public function test_cancelled_projection_keeps_existing_search_rows(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/keep.md', "# Keep\n");
        $disk->put('users/bob/later.md', "# Later\n");
        app(SearchReindexRunner::class)->run();
        $this->assertSearchDocumentExists('users/bob/keep.md');
        $this->assertSearchDocumentExists('users/bob/later.md');
        $this->insertSearchDocument('caldav', 'bob|default|keep.ics');

        $ticks = 0;
        try {
            app(SearchIndexerService::class)->reindexAllFromFileNodes(
                function (int $done, int $total, string $phase) use (&$ticks): void {
                    if ($phase !== 'files') {
                        return;
                    }
                    $ticks++;
                    if ($ticks >= 1) {
                        throw new \RuntimeException('Search reindex cancelled by user.');
                    }
                },
            );
            $this->fail('Expected the projection to stop on cancel.');
        } catch (\RuntimeException $e) {
            $this->assertSame('Search reindex cancelled by user.', $e->getMessage());
        }

        $this->assertGreaterThan(0, $ticks);
        $this->assertSearchDocumentExists('users/bob/keep.md');
        $this->assertSearchDocumentExists('users/bob/later.md');
        $this->assertNotNull($this->searchDocument('caldav', 'bob|default|keep.ics'));
        $this->assertNoSearchDocumentsWithoutALiveFileNode();
    }

    public function test_directory_move_replaces_search_keys_with_the_new_path(): void
    {
        $this->createDriveDirectory('/users/bob', 'dir');
        $this->createDriveFile($this->userBearerToken(), '/users/bob/dir', 'a.md');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            '/users/bob/dir',
            'dir2',
        ));

        $this->assertSearchDocumentMissing('users/bob/dir');
        $this->assertSearchDocumentMissing('users/bob/dir/a.md');
        $this->assertSearchDocumentExists('users/bob/dir2');
        $this->assertSearchDocumentExists('users/bob/dir2/a.md');
        $this->assertNoSearchDocumentsWithoutALiveFileNode();
    }

    public function test_rename_out_of_a_hidden_name_mints_a_node_before_search(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/.secret.md', "# Secret\n");

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            '/users/bob/.secret.md',
            'notes.md',
        ));

        $this->assertNotNull(
            JmapFileNode::query()
                ->where('storage_key', 'users/bob/notes.md')
                ->whereNull('deleted_at')
                ->first(),
        );
        $this->assertSearchDocumentMissing('users/bob/.secret.md');
        $this->assertSearchDocumentExists('users/bob/notes.md');
        $this->assertNoSearchDocumentsWithoutALiveFileNode();
    }

    public function test_collab_markdown_write_keeps_both_indexes_in_sync(): void
    {
        $key = 'users/bob/collab-new.md';
        $this->withBearer($this->userBearerToken())
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode('/'.$key), "# Collab\n")
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->assertNotNull(
            JmapFileNode::query()->where('storage_key', $key)->whereNull('deleted_at')->first(),
        );
        $this->assertSearchDocumentExists($key);
    }

    public function test_reindex_keeps_a_calendar_object_whose_uri_contains_percent_encoding(): void
    {
        DB::connection('wgw')->table('calendars')->insert([
            'id' => 1,
            'synctoken' => 1,
            'components' => 'VEVENT',
        ]);
        DB::connection('wgw')->table('calendarinstances')->insert([
            'id' => 1,
            'calendarid' => 1,
            'principaluri' => 'principals/bob',
            'access' => 1,
            'uri' => 'default',
            'displayname' => 'Default',
        ]);
        DB::connection('wgw')->table('calendarobjects')->insert([
            'calendardata' => "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meet-1\r\nSUMMARY:Meet ing\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
            'uri' => 'meet%20ing.ics',
            'calendarid' => 1,
            'lastmodified' => time(),
            'etag' => '"m1"',
            'size' => 120,
            'componenttype' => 'VEVENT',
            'firstoccurence' => time(),
            'lastoccurence' => time(),
            'uid' => 'meet-1',
        ]);

        app(SearchReindexRunner::class)->run();

        $this->assertNotNull($this->searchDocument('caldav', 'bob|default|meet ing.ics'));
    }

    public function test_backfill_writes_a_search_row_when_it_mints_a_node(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/minted.md', "# Minted\n");

        app(FileNodeReindexer::class)->reindexAll();

        $this->assertNotNull(
            JmapFileNode::query()
                ->where('storage_key', 'users/bob/minted.md')
                ->whereNull('deleted_at')
                ->first(),
        );
        $this->assertSearchDocumentExists('users/bob/minted.md');
    }

    private function insertSearchDocument(string $sourceType, string $sourceKey): void
    {
        // Older than any gmdate('c') cutoff, in UTC, so a stale sweep deletes
        // the row on every timezone. date('c') can sort after that cutoff.
        DB::connection('wgw')->table('search_documents')->insert([
            'source_type' => $sourceType,
            'source_key' => $sourceKey,
            'created_at' => '2000-01-01T00:00:00+00:00',
            'updated_at' => '2000-01-01T00:00:00+00:00',
        ]);
    }

    private function searchDocument(string $sourceType, string $sourceKey): ?object
    {
        $row = DB::connection('wgw')->table('search_documents')
            ->where('source_type', $sourceType)
            ->where('source_key', $sourceKey)
            ->first();

        return $row === null ? null : $row;
    }

    private function assertNoSearchDocumentsWithoutALiveFileNode(): void
    {
        $keys = JmapFileNode::query()->whereNull('deleted_at')->pluck('storage_key')->all();
        $orphans = DB::connection('wgw')->table('search_documents')
            ->whereIn('source_type', ['file', 'note'])
            ->whereNotIn('source_key', $keys)
            ->pluck('source_key')
            ->all();
        $this->assertSame([], $orphans, 'search_documents rows without a live file node');
    }

    private function keyIsTrashOrAttachment(string $key): bool
    {
        foreach (explode('/', $key) as $segment) {
            if ($segment === '.Trash' || $segment === '.attachments') {
                return true;
            }
        }

        return false;
    }
}
