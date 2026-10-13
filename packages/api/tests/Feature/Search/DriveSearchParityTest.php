<?php

declare(strict_types=1);

namespace Tests\Feature\Search;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Search\SearchIndexerService;
use App\Services\Search\SearchReindexRunner;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Drive lists `jmap_file_nodes`; Docs home and search read `search_documents`.
 * A markdown file must not be able to land in one index without the other.
 */
final class DriveSearchParityTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

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
            ->putJson('/api/v1/files/collaboration?path='.urlencode('/'.$key), [
                'markdown' => "# Collab\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->assertNotNull(
            JmapFileNode::query()->where('storage_key', $key)->whereNull('deleted_at')->first(),
        );
        $this->assertSearchDocumentExists($key);
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
