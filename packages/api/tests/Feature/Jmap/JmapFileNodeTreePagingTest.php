<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\ProjectArchivePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2063 chunk S1: the cheap paged tree read. An unfiltered FileNode/query pages the
 * caller's whole visible tree by a `node_id` keyset (`idAfter`), limited to the nodes
 * that existed at `asOfState`, and FileNode/get returns each node's virtual `path`.
 * bob sees his home and the `team` drive; carol's home is not his.
 */
final class JmapFileNodeTreePagingTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const TREE_USING = [JmapCapabilities::CORE, JmapCapabilities::FILENODE, JmapCapabilities::FILENODE_TREE];

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
     * @param  list<string>  $using
     */
    private function jmapAs(string $username, array $methodCalls, array $using = self::TREE_USING): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($username))->postJson('/api/v1/jmap', [
            'using' => $using,
            'methodCalls' => $methodCalls,
        ]);
    }

    /**
     * @param  array<string, mixed>  $args
     * @return array<string, mixed> the FileNode/query response arguments
     */
    private function page(string $username, array $args): array
    {
        $response = $this->jmapAs($username, [
            ['FileNode/query', ['accountId' => $username, 'sort' => [['property' => 'id']], ...$args], 'q'],
        ])->assertOk()->json('methodResponses.0');
        $this->assertSame('FileNode/query', $response[0], (string) json_encode($response[1]));

        return (array) $response[1];
    }

    private function stateOf(string $username): string
    {
        return (string) $this->jmapAs($username, [
            ['FileNode/get', ['accountId' => $username, 'ids' => []], 's'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /**
     * Walks the tree in pages of `$limit`; `$between` runs after each page.
     *
     * @param  (callable(int, list<string>): void)|null  $between
     * @return list<string> every id in walk order
     */
    private function walk(string $username, int $limit, ?string $asOfState = null, ?callable $between = null): array
    {
        $ids = [];
        $idAfter = null;
        $asOfState ??= $this->stateOf($username);
        for ($guard = 0; $guard < 100; $guard++) {
            $args = ['limit' => $limit, 'asOfState' => $asOfState];
            if ($idAfter !== null) {
                $args['idAfter'] = $idAfter;
            }
            $page = (array) $this->page($username, $args)['ids'];
            array_push($ids, ...$page);
            if (count($page) < $limit) {
                return $ids;
            }
            $idAfter = $page[count($page) - 1];
            if ($between !== null) {
                $between($guard, $page);
            }
        }
        $this->fail('The walk did not end.');
    }

    /** @return list<string> */
    private function liveVisibleIds(string $username): array
    {
        $list = (array) $this->jmapAs($username, [
            ['FileNode/get', ['accountId' => $username, 'ids' => null, 'properties' => ['id']], 'g'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $ids = array_map(static fn (array $node): string => (string) $node['id'], $list);
        sort($ids, SORT_STRING);

        return $ids;
    }

    private function seedFolders(string $root, int $folders, int $filesPerFolder): void
    {
        $disk = app(WgwStorage::class)->files();
        for ($f = 0; $f < $folders; $f++) {
            for ($i = 0; $i < $filesPerFolder; $i++) {
                $disk->put(sprintf('%s/folder%02d/file%02d.md', $root, $f, $i), 'x');
            }
        }
    }

    private function nodeIdAt(string $key): string
    {
        $node = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($node, 'No live node at '.$key);

        return (string) $node->node_id;
    }

    private function sqlCount(callable $run): int
    {
        $count = 0;
        DB::connection('wgw')->listen(static function () use (&$count): void {
            $count++;
        });
        $count = 0;
        $run();

        return $count;
    }

    private function shareFolder(string $owner, string $path, string $grantee): void
    {
        $this->withBearer($this->issueBearerTokenFor($owner))->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [$grantee => ['access' => 'view']],
        ])->assertOk();
    }

    public function test_query_page_sql_count_does_not_grow_with_folder_count(): void
    {
        $this->seedFolders('users/bob', 2, 10);
        $this->liveVisibleIds('bob');
        $pagePair = function (): void {
            $this->jmapAs('bob', [
                ['FileNode/get', ['accountId' => 'bob', 'ids' => []], 's'],
                ['FileNode/query', [
                    'accountId' => 'bob', 'sort' => [['property' => 'id']], 'limit' => 10, 'idAfter' => 'fn-',
                    '#asOfState' => ['resultOf' => 's', 'name' => 'FileNode/get', 'path' => '/state'],
                ], 'q'],
                ['FileNode/get', [
                    'accountId' => 'bob', 'properties' => ['id', 'parentId', 'name', 'path'],
                    '#ids' => ['resultOf' => 'q', 'name' => 'FileNode/query', 'path' => '/ids'],
                ], 'g'],
            ])->assertOk()->assertJsonCount(10, 'methodResponses.2.1.list');
        };
        $few = $this->sqlCount($pagePair);

        $this->seedFolders('users/bob/more', 30, 2);
        $this->liveVisibleIds('bob');
        $many = $this->sqlCount($pagePair);

        $this->assertSame($few, $many, 'A keyset page must not reconcile or read per folder.');
    }

    public function test_keyset_walk_reads_the_index_and_the_open_folder_heals(): void
    {
        $this->seedFolders('users/bob', 1, 1);
        $this->liveVisibleIds('bob');
        $folder = $this->nodeIdAt('users/bob/folder00');

        // Written past the app (SFTP, a restore): the walk does not list the disk for it.
        app(WgwStorage::class)->files()->put('users/bob/folder00/late.md', 'x');
        $this->page('bob', ['limit' => 500, 'idAfter' => null]);
        $this->assertNull(app(FileNodeIndexService::class)->liveByKey('users/bob/folder00/late.md'));

        // Listing that folder (the client opens it) reconciles it.
        $listed = $this->jmapAs('bob', [
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['parentId' => $folder]], 'q'],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $this->assertContains($this->nodeIdAt('users/bob/folder00/late.md'), $listed);
    }

    public function test_keyset_walk_survives_a_delete_before_the_cursor(): void
    {
        $this->seedFolders('users/bob', 2, 6);
        $before = $this->liveVisibleIds('bob');
        $state = $this->stateOf('bob');
        $index = app(FileNodeIndexService::class);
        $disk = app(WgwStorage::class)->files();
        $deleted = null;
        $renamed = null;

        $walked = $this->walk('bob', 4, $state, function (int $pageNo, array $page) use ($index, $disk, &$deleted, &$renamed): void {
            if ($pageNo !== 0) {
                return;
            }
            // Delete one node of the first page and rename another: position paging would shift.
            foreach ($page as $id) {
                $node = $index->liveByNodeId($id);
                if ($node === null || $node->is_dir || ! str_starts_with((string) $node->storage_key, 'users/bob/folder')) {
                    continue;
                }
                $key = (string) $node->storage_key;
                if ($deleted === null) {
                    $disk->delete($key);
                    $index->recordDelete($key);
                    $deleted = $id;
                } elseif ($renamed === null) {
                    $disk->move($key, $key.'.renamed');
                    $index->recordMove($key, $key.'.renamed');
                    $renamed = $id;
                }
            }
        });

        $this->assertNotNull($deleted);
        $this->assertNotNull($renamed);
        $this->assertSame(array_values(array_unique($walked)), $walked, 'No node is returned twice.');
        // Every node that existed for the whole walk is returned exactly once.
        $expected = array_values(array_diff($before, [$deleted]));
        $this->assertSame([], array_values(array_diff($expected, $walked)));
        $this->assertContains($renamed, $walked);
    }

    public function test_keyset_chain_resolves_id_after_by_result_reference(): void
    {
        $this->seedFolders('users/bob', 2, 5);
        $this->seedFolders('groups/team', 1, 3);
        $expected = $this->liveVisibleIds('bob');
        $limit = 4;
        $pairs = (int) ceil((count($expected) + 1) / $limit) + 1;

        $calls = [['FileNode/get', ['accountId' => 'bob', 'ids' => []], 's']];
        for ($p = 0; $p < $pairs; $p++) {
            $query = [
                'accountId' => 'bob',
                'sort' => [['property' => 'id']],
                'limit' => $limit,
                '#asOfState' => ['resultOf' => 's', 'name' => 'FileNode/get', 'path' => '/state'],
            ];
            if ($p > 0) {
                $query['#idAfter'] = ['resultOf' => 'q'.($p - 1), 'name' => 'FileNode/query', 'path' => '/ids/'.($limit - 1)];
            }
            $calls[] = ['FileNode/query', $query, 'q'.$p];
            $calls[] = ['FileNode/get', [
                'accountId' => 'bob',
                'properties' => ['id', 'parentId', 'name', 'path'],
                '#ids' => ['resultOf' => 'q'.$p, 'name' => 'FileNode/query', 'path' => '/ids'],
            ], 'g'.$p];
        }
        $responses = (array) $this->jmapAs('bob', $calls)->assertOk()->json('methodResponses');

        $walked = [];
        $ended = false;
        foreach ($responses as [$name, $args, $callId]) {
            if (! str_starts_with((string) $callId, 'q')) {
                continue;
            }
            if ($ended) {
                // The page after the short page has no /ids/3 to reference.
                $this->assertSame('error', $name);
                $this->assertSame('invalidResultReference', $args['type']);

                continue;
            }
            $this->assertSame('FileNode/query', $name, (string) json_encode($args));
            array_push($walked, ...$args['ids']);
            $ended = count($args['ids']) < $limit;
        }

        $this->assertTrue($ended, 'The chain reaches a short page.');
        $this->assertSame($expected, $walked);
    }

    public function test_as_of_state_excludes_nodes_created_after_it(): void
    {
        $this->seedFolders('users/bob', 1, 2);
        $this->liveVisibleIds('bob');
        $state = $this->stateOf('bob');

        app(WgwStorage::class)->files()->put('users/bob/folder00/after.md', 'x');
        app(FileNodeIndexService::class)->recordCreate('users/bob/folder00/after.md');
        $after = $this->nodeIdAt('users/bob/folder00/after.md');

        $this->assertNotContains($after, $this->walk('bob', 500, $state));
        $this->assertContains($after, $this->walk('bob', 500));
        $this->assertContains($after, $this->page('bob', ['limit' => 500, 'asOfState' => null])['ids']);
    }

    public function test_keyset_page_is_in_node_id_order(): void
    {
        $this->seedFolders('users/bob', 3, 4);
        $this->liveVisibleIds('bob');

        $page = $this->page('bob', ['limit' => 7, 'asOfState' => $this->stateOf('bob'), 'calculateTotal' => true]);
        $ids = $page['ids'];
        $sorted = $ids;
        sort($sorted, SORT_STRING);
        $this->assertCount(7, $ids);
        $this->assertSame($sorted, $ids);
        $this->assertSame(0, $page['position']);
        $this->assertSame(7, $page['limit']);
        $this->assertSame(count($this->liveVisibleIds('bob')), $page['total']);

        // The next page starts after the greatest id of this one.
        $next = $this->page('bob', ['limit' => 7, 'idAfter' => $ids[6]])['ids'];
        $this->assertGreaterThan(0, strcmp($next[0], $ids[6]));
    }

    public function test_get_returns_virtual_path_for_share_roots(): void
    {
        $disk = app(WgwStorage::class)->files();
        // Two share roots with the same name, at different places in alice's home.
        foreach (['users/alice/Reports', 'users/alice/Archive/Reports'] as $key) {
            $disk->put($key.'/q3.md', 'x');
            $this->shareFolder('alice', '/'.$key, 'bob');
        }
        $disk->put('users/bob/Notes/todo.md', 'x');
        $this->liveVisibleIds('bob');

        $ids = $this->walk('bob', 500);
        $list = (array) $this->jmapAs('bob', [
            ['FileNode/get', ['accountId' => 'bob', 'ids' => $ids, 'properties' => ['id', 'parentId', 'name', 'path']], 'g'],
        ])->assertOk()->json('methodResponses.0.1.list');
        $paths = array_column($list, 'path', 'id');
        $parents = array_column($list, 'parentId', 'id');

        $outer = $this->nodeIdAt('users/alice/Reports');
        $inner = $this->nodeIdAt('users/alice/Archive/Reports');
        $this->assertSame('/users/alice/Reports', $paths[$outer]);
        $this->assertSame('/users/alice/Archive/Reports', $paths[$inner]);
        $this->assertSame('/users/alice/Archive/Reports/q3.md', $paths[$this->nodeIdAt('users/alice/Archive/Reports/q3.md')]);
        // A share root keeps its owner's parent, which bob cannot see.
        $this->assertArrayNotHasKey((string) $parents[$inner], $paths);
        // Account roots and their descendants.
        $this->assertSame('/users/bob', $paths[$this->nodeIdAt('users/bob')]);
        $this->assertSame('/groups/team', $paths[$this->nodeIdAt('groups/team')]);
        $this->assertSame('/users/bob/Notes/todo.md', $paths[$this->nodeIdAt('users/bob/Notes/todo.md')]);
        // Nothing else of alice's home is walked.
        foreach ($paths as $path) {
            $this->assertMatchesRegularExpression('#^/(users/bob|groups/team|users/alice/Reports|users/alice/Archive/Reports)(/|$)#', (string) $path);
        }
    }

    public function test_keyset_walk_stays_in_the_callers_roots(): void
    {
        $this->seedFolders('users/carol', 2, 3);
        $this->seedFolders('users/bob', 1, 2);
        $this->liveVisibleIds('bob');
        $carolIds = $this->liveVisibleIds('carol');

        $walked = $this->walk('bob', 3);

        $this->assertSame($this->liveVisibleIds('bob'), $walked);
        $this->assertSame([], array_values(array_intersect($carolIds, $walked)));
    }

    public function test_keyset_walk_skips_the_archived_project_tree(): void
    {
        $disk = app(WgwStorage::class)->files();
        $archived = ProjectArchivePaths::keyFor('team', 'old-project').'/plan.md';
        $disk->put($archived, 'x');
        $disk->put('groups/team/live.md', 'x');
        app(FileNodeIndexService::class)->recordCreate($archived);
        $archivedId = $this->nodeIdAt($archived);
        $this->liveVisibleIds('bob');

        $walked = $this->walk('bob', 2);

        $this->assertNotContains($archivedId, $walked);
        $this->assertContains($this->nodeIdAt('groups/team/live.md'), $walked);
        $this->assertSame($this->liveVisibleIds('bob'), $walked);
    }

    public function test_keyset_arguments_need_the_tree_capability(): void
    {
        $this->jmapAs('bob', [
            ['FileNode/query', ['accountId' => 'bob', 'idAfter' => 'fn-'], 'q'],
        ], [JmapCapabilities::CORE, JmapCapabilities::FILENODE])->assertOk()
            ->assertJsonPath('methodResponses.0.0', 'error')
            ->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');

        $list = (array) $this->jmapAs('bob', [
            ['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g'],
        ], [JmapCapabilities::CORE, JmapCapabilities::FILENODE])->assertOk()->json('methodResponses.0.1.list');
        $this->assertNotEmpty($list);
        $this->assertArrayNotHasKey('path', $list[0]);
    }

    public function test_keyset_page_takes_no_filter_sort_or_position(): void
    {
        $cases = [
            [['filter' => ['nodeType' => 'file']], 'invalidArguments'],
            [['sort' => [['property' => 'name']]], 'unsupportedSort'],
            [['sort' => [['property' => 'id', 'isAscending' => false]]], 'unsupportedSort'],
            [['position' => 3], 'invalidArguments'],
            [['asOfState' => 'not-a-state'], 'invalidArguments'],
            [['idAfter' => 42], 'invalidArguments'],
        ];
        foreach ($cases as [$args, $type]) {
            $this->jmapAs('bob', [
                ['FileNode/query', ['accountId' => 'bob', 'idAfter' => 'fn-', ...$args], 'q'],
            ])->assertOk()
                ->assertJsonPath('methodResponses.0.0', 'error')
                ->assertJsonPath('methodResponses.0.1.type', $type);
        }
    }

    public function test_session_advertises_the_tree_extension(): void
    {
        $session = $this->withBearer($this->issueBearerTokenFor('bob'))->getJson('/api/v1/jmap/session')->assertOk()->json();

        $this->assertSame([], $session['capabilities'][JmapCapabilities::FILENODE_TREE]);
        $this->assertSame([], $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::FILENODE_TREE]);
        $this->assertContains('id', $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::FILENODE]['fileNodeQuerySortOptions']);
    }
}
