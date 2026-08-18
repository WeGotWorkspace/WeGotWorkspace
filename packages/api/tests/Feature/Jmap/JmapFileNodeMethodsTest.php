<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Dav\Server\FileNodeIndexPlugin;
use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Illuminate\Testing\TestResponse;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Files envelope methods (#450, draft-ietf-jmap-filenode-14 pinned):
 * FileNode/get|changes|set|copy|query|queryChanges over the node-identity
 * index, per the approved design doc (docs/files/jmap-filenode-design.md).
 */
final class JmapFileNodeMethodsTest extends WgwDatabaseTestCase
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

    /**
     * @return array<string, array<string, mixed>> nodes keyed by storage-visible name path
     */
    private function getAll(): array
    {
        $list = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $byId = [];
        foreach ($list as $node) {
            $byId[$node['id']] = $node;
        }

        return $byId;
    }

    private function nodeIdByName(array $nodes, string $name): string
    {
        foreach ($nodes as $node) {
            if ($node['name'] === $name) {
                return $node['id'];
            }
        }
        $this->fail('No node named '.$name);
    }

    public function test_session_advertises_filenode_with_draft14_capability_placement(): void
    {
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();

        $this->assertSame([], $session['capabilities'][JmapCapabilities::FILENODE]);
        $account = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::FILENODE];
        $this->assertSame(255, $account['maxSizeFileNodeName']);
        $this->assertFalse($account['mayCreateTopLevelFileNode']);
        $this->assertFalse($account['caseInsensitiveNames']);
        $this->assertNull($account['webWriteUrlTemplate']);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::FILENODE]);
    }

    public function test_files_feature_gate_drops_the_domain(): void
    {
        $this->setAppSetting(WgwSettings::FILES_ENABLED, false);

        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $this->assertArrayNotHasKey(JmapCapabilities::FILENODE, $session['capabilities']);
    }

    public function test_get_all_returns_roots_and_files_with_draft_shape(): void
    {
        $this->seedPrivateFile('bob', 'hello.txt', 'hello world');

        $nodes = $this->getAll();

        $roots = array_values(array_filter($nodes, static fn (array $n): bool => $n['parentId'] === null));
        $this->assertEqualsCanonicalizing(['bob', 'team'], array_column($roots, 'name'));
        foreach ($roots as $root) {
            $this->assertFalse($root['myRights']['mayShare']);
        }

        $fileId = $this->nodeIdByName($nodes, 'hello.txt');
        $file = $nodes[$fileId];
        $this->assertSame('file', $file['nodeType']);
        $this->assertSame(strlen('hello world'), $file['size']);
        $this->assertMatchesRegularExpression('/^fnb-fn-[0-9a-f]{32}-[0-9a-f]{8}$/', $file['blobId']);
        $this->assertStringStartsWith('text/plain', $file['type']);
        $this->assertTrue($file['myRights']['mayRead']);
        $this->assertTrue($file['myRights']['mayModifyContent']);
        $this->assertTrue($file['myRights']['mayShare']);
        $this->assertNull($file['shareWith']);
        // Its parent chain reaches bob's root.
        $this->assertSame($this->nodeIdByName($nodes, 'bob'), $file['parentId']);
    }

    public function test_get_by_id_not_found_and_fetch_parents(): void
    {
        $this->seedPrivateFile('bob', 'deep/nested/file.txt');
        $nodes = $this->getAll();
        $fileId = $this->nodeIdByName($nodes, 'file.txt');

        $response = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => [$fileId, 'fn-missing'], 'fetchParents' => true], 'c0'],
        ])->assertOk();

        $list = $response->json('methodResponses.0.1.list');
        $names = array_column($list, 'name');
        // The node itself plus every ancestor up to the root.
        $this->assertEqualsCanonicalizing(['file.txt', 'nested', 'deep', 'bob'], $names);
        $this->assertSame(['fn-missing'], $response->json('methodResponses.0.1.notFound'));
    }

    public function test_set_creates_directories_and_files_from_uploaded_blobs(): void
    {
        $nodes = $this->getAll();
        $homeId = $this->nodeIdByName($nodes, 'bob');
        $blobId = $this->uploadBlob('file body');

        $response = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'd0' => ['parentId' => $homeId, 'name' => 'Projects'],
                'f0' => ['parentId' => $homeId, 'name' => 'notes.txt', 'blobId' => $blobId],
            ]], 'c0'],
        ])->assertOk();

        $dir = $response->json('methodResponses.0.1.created.d0');
        $this->assertSame('directory', $dir['nodeType']);
        $this->assertNull($dir['blobId']);
        $file = $response->json('methodResponses.0.1.created.f0');
        $this->assertSame('file', $file['nodeType']);
        $this->assertSame(strlen('file body'), $file['size']);

        $disk = app(WgwStorage::class)->files();
        $this->assertTrue($disk->directoryExists('users/bob/Projects'));
        $this->assertSame('file body', $disk->get('users/bob/notes.txt'));
    }

    public function test_rename_keeps_the_node_id_and_reports_exactly_one_update(): void
    {
        $this->seedPrivateFile('bob', 'Projects/plan.txt', 'v1');
        $nodes = $this->getAll();
        $fileId = $this->nodeIdByName($nodes, 'plan.txt');
        $dirId = $this->nodeIdByName($nodes, 'Projects');
        $state = (string) app(FileNodeIndexService::class)->currentSeq();

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['name' => 'plan-v2.txt']]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $changes = $this->jmap([
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c1'],
        ])->assertOk();
        $this->assertSame([$fileId], $changes->json('methodResponses.0.1.updated'));
        $this->assertSame([], $changes->json('methodResponses.0.1.created'));
        $this->assertSame([], $changes->json('methodResponses.0.1.destroyed'));

        // Ancestor rename: only the directory itself changes, descendants
        // keep id AND seq (parent links are by id).
        $state = (string) app(FileNodeIndexService::class)->currentSeq();
        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$dirId => ['name' => 'Archive']]], 'c2'],
        ])->assertOk();
        $changes = $this->jmap([
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c3'],
        ])->assertOk();
        $this->assertSame([$dirId], $changes->json('methodResponses.0.1.updated'));

        // The file is still reachable under the renamed directory with the
        // same id.
        $get = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => [$fileId]], 'c4'],
        ])->assertOk();
        $this->assertSame('plan-v2.txt', $get->json('methodResponses.0.1.list.0.name'));
        $this->assertSame($dirId, $get->json('methodResponses.0.1.list.0.parentId'));
    }

    public function test_move_between_directories_via_parent_id(): void
    {
        $this->seedPrivateFile('bob', 'A/doc.txt');
        app(WgwStorage::class)->files()->makeDirectory('users/bob/B');
        $nodes = $this->getAll();
        $fileId = $this->nodeIdByName($nodes, 'doc.txt');
        $targetId = $this->nodeIdByName($nodes, 'B');

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$fileId => ['parentId' => $targetId]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $disk = app(WgwStorage::class)->files();
        $this->assertTrue($disk->fileExists('users/bob/B/doc.txt'));
        $this->assertFalse($disk->fileExists('users/bob/A/doc.txt'));
    }

    public function test_move_into_own_descendant_is_rejected(): void
    {
        app(WgwStorage::class)->files()->makeDirectory('users/bob/outer/inner');
        $nodes = $this->getAll();
        $outerId = $this->nodeIdByName($nodes, 'outer');
        $innerId = $this->nodeIdByName($nodes, 'inner');

        $response = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$outerId => ['parentId' => $innerId]]], 'c0'],
        ])->assertOk();
        $response->assertJsonPath('methodResponses.0.1.notUpdated.'.$outerId.'.type', 'invalidProperties');
    }

    public function test_on_exists_matrix(): void
    {
        $this->seedPrivateFile('bob', 'report.txt', 'existing');
        $nodes = $this->getAll();
        $homeId = $this->nodeIdByName($nodes, 'bob');
        $existingId = $this->nodeIdByName($nodes, 'report.txt');
        $blobId = $this->uploadBlob('incoming');

        // Default: alreadyExists with existingId (draft-14 §3.2.3).
        $reject = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                'k0' => ['parentId' => $homeId, 'name' => 'report.txt', 'blobId' => $blobId],
            ]], 'c0'],
        ])->assertOk();
        $reject->assertJsonPath('methodResponses.0.1.notCreated.k0.type', 'alreadyExists');
        $reject->assertJsonPath('methodResponses.0.1.notCreated.k0.existingId', $existingId);

        // rename: server-chosen unique name.
        $renamed = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'onExists' => 'rename', 'create' => [
                'k1' => ['parentId' => $homeId, 'name' => 'report.txt', 'blobId' => $blobId],
            ]], 'c1'],
        ])->assertOk();
        $this->assertSame('report (2).txt', $renamed->json('methodResponses.0.1.created.k1.name'));

        // replace: the existing node is destroyed and listed as such.
        $replaced = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'onExists' => 'replace', 'create' => [
                'k2' => ['parentId' => $homeId, 'name' => 'report.txt', 'blobId' => $blobId],
            ]], 'c2'],
        ])->assertOk();
        $this->assertContains($existingId, $replaced->json('methodResponses.0.1.destroyed'));
        $this->assertSame('report.txt', $replaced->json('methodResponses.0.1.created.k2.name'));
    }

    public function test_destroy_requires_on_destroy_remove_children_for_non_empty_directories(): void
    {
        $this->seedPrivateFile('bob', 'stuffed/inside.txt');
        $nodes = $this->getAll();
        $dirId = $this->nodeIdByName($nodes, 'stuffed');
        $childId = $this->nodeIdByName($nodes, 'inside.txt');

        $refused = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$dirId]], 'c0'],
        ])->assertOk();
        $refused->assertJsonPath('methodResponses.0.1.notDestroyed.'.$dirId.'.type', 'nodeHasChildren');

        // Destroying the directory plus its children in one call is fine.
        $together = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$dirId, $childId]], 'c1'],
        ])->assertOk();
        $this->assertEqualsCanonicalizing([$dirId, $childId], $together->json('methodResponses.0.1.destroyed'));
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('users/bob/stuffed'));
    }

    public function test_destroy_with_on_destroy_remove_children_removes_the_subtree(): void
    {
        $this->seedPrivateFile('bob', 'doomed/a.txt');
        $this->seedPrivateFile('bob', 'doomed/sub/b.txt');
        $nodes = $this->getAll();
        $dirId = $this->nodeIdByName($nodes, 'doomed');
        $state = (string) app(FileNodeIndexService::class)->currentSeq();

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$dirId], 'onDestroyRemoveChildren' => true], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $dirId);

        $changes = $this->jmap([
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c1'],
        ])->assertOk();
        // The directory and every descendant surface as destroyed.
        $this->assertCount(4, $changes->json('methodResponses.0.1.destroyed'));
    }

    public function test_top_level_if_in_state_rejects_stale_state_without_mutating(): void
    {
        $nodes = $this->getAll();
        $homeId = $this->nodeIdByName($nodes, 'bob');

        $response = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'ifInState' => '999999', 'create' => [
                'd0' => ['parentId' => $homeId, 'name' => 'NotCreated'],
            ]], 'c0'],
        ])->assertOk();
        $response->assertJsonPath('methodResponses.0.0', 'error');
        $response->assertJsonPath('methodResponses.0.1.type', 'stateMismatch');
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('users/bob/NotCreated'));
    }

    public function test_query_supports_the_honest_subset(): void
    {
        $this->seedPrivateFile('bob', 'Projects/alpha.txt');
        $this->seedPrivateFile('bob', 'Projects/sub/beta.txt');
        $nodes = $this->getAll();
        $projectsId = $this->nodeIdByName($nodes, 'Projects');

        // parentId without depth: direct children only.
        $direct = $this->jmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['parentId' => $projectsId]], 'c0'],
        ])->assertOk();
        $this->assertCount(2, $direct->json('methodResponses.0.1.ids'));

        // depth recurses.
        $deep = $this->jmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['parentId' => $projectsId], 'depth' => 3], 'c1'],
        ])->assertOk();
        $this->assertCount(3, $deep->json('methodResponses.0.1.ids'));

        // nameMatch glob, case-insensitive.
        $glob = $this->jmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['parentId' => $projectsId, 'nameMatch' => 'ALPHA.*']], 'c2'],
        ])->assertOk();
        $this->assertCount(1, $glob->json('methodResponses.0.1.ids'));

        // isTopLevel: the account's roots.
        $roots = $this->jmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['isTopLevel' => true]], 'c3'],
        ])->assertOk();
        $this->assertCount(2, $roots->json('methodResponses.0.1.ids'));

        // Unsupported filter/sort → honest errors.
        $this->jmap([
            ['FileNode/query', ['accountId' => 'bob', 'filter' => ['minSize' => 10]], 'c4'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'unsupportedFilter');
        $this->jmap([
            ['FileNode/query', ['accountId' => 'bob', 'sort' => [['property' => 'size']]], 'c5'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'unsupportedSort');
    }

    public function test_query_changes_is_cannot_calculate_changes(): void
    {
        $this->jmap([
            ['FileNode/queryChanges', ['accountId' => 'bob', 'sinceQueryState' => '0'], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }

    public function test_copy_is_shaped_but_single_account(): void
    {
        $this->jmap([
            ['FileNode/copy', ['fromAccountId' => 'bob', 'accountId' => 'bob'], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'invalidArguments');

        $this->jmap([
            ['FileNode/copy', ['fromAccountId' => 'someone-else', 'accountId' => 'bob'], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'fromAccountNotFound');
    }

    public function test_hidden_segments_are_not_file_nodes(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/.notes/Drafts/secret.md', 'note');
        $disk->put('users/bob/.hidden.yjs', 'sidecar');
        $this->seedPrivateFile('bob', 'visible.txt');

        $names = array_column(array_values($this->getAll()), 'name');
        $this->assertContains('visible.txt', $names);
        $this->assertNotContains('secret.md', $names);
        $this->assertNotContains('.hidden.yjs', $names);
        $this->assertNotContains('.notes', $names);
    }

    public function test_product_trash_is_a_file_node_and_can_receive_moves(): void
    {
        $this->seedPrivateFile('bob', 'toss.txt', 'bye');
        $nodes = $this->getAll();
        $homeId = $this->nodeIdByName($nodes, 'bob');
        $fileId = $this->nodeIdByName($nodes, 'toss.txt');

        $created = $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'create' => [
                't0' => ['parentId' => $homeId, 'name' => '.Trash'],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.t0');
        $this->assertSame('directory', $created['nodeType']);
        $this->assertSame('.Trash', $created['name']);
        $trashId = $created['id'];

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [
                $fileId => ['parentId' => $trashId],
            ]], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$fileId, null);

        $this->assertFalse(app(WgwStorage::class)->files()->fileExists('users/bob/toss.txt'));
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists('users/bob/.Trash/toss.txt'));

        $after = $this->getAll();
        $this->assertContains('.Trash', array_column(array_values($after), 'name'));
        $this->assertSame($trashId, $after[$fileId]['parentId']);
    }

    public function test_group_visibility_and_cross_account_scoping(): void
    {
        $this->seedGroupFile('shared.txt', 'team file');
        $this->seedPrivateFile('bob', 'private.txt');

        // bob (team member) sees the group node.
        $bobNodes = array_column(array_values($this->getAll()), 'name');
        $this->assertContains('shared.txt', $bobNodes);

        // carol (not a member) sees neither the group tree nor bob's file.
        $carolList = $this->jmap([
            ['FileNode/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
        ], $this->carolBearerToken())->assertOk()->json('methodResponses.0.1.list');
        $carolNames = array_column($carolList, 'name');
        $this->assertNotContains('shared.txt', $carolNames);
        $this->assertNotContains('private.txt', $carolNames);

        // carol cannot fetch bob's node by id either.
        $bobFileId = $this->nodeIdByName($this->getAll(), 'private.txt');
        $this->jmap([
            ['FileNode/get', ['accountId' => 'carol', 'ids' => [$bobFileId]], 'c1'],
        ], $this->carolBearerToken())->assertOk()
            ->assertJsonPath('methodResponses.0.1.notFound.0', $bobFileId);
    }

    public function test_file_content_downloads_via_fnb_blob_id_with_account_scoping(): void
    {
        $this->seedPrivateFile('bob', 'download-me.txt', 'file content here');
        $nodes = $this->getAll();
        $blobId = $nodes[$this->nodeIdByName($nodes, 'download-me.txt')]['blobId'];

        $download = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/jmap/download/bob/'.$blobId.'/download-me.txt')
            ->assertOk();
        $this->assertSame('file content here', $download->getContent());

        // carol cannot reach it through her own account path.
        $this->withBearer($this->carolBearerToken())
            ->get('/api/v1/jmap/download/carol/'.$blobId.'/x.txt')
            ->assertStatus(404);
    }

    public function test_dav_write_path_updates_the_index_via_the_plugin(): void
    {
        // Exercise the plugin handler directly with Sabre HTTP objects — the
        // full DAV front needs an install fixture; the plugin's contract is
        // path→key mapping + index recording.
        $this->getAll(); // ensure roots exist
        $state = (string) app(FileNodeIndexService::class)->currentSeq();

        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/dav-upload.bin', 'dav bytes');

        $plugin = new FileNodeIndexPlugin(app(FileNodeIndexService::class));
        $plugin->afterWriteMethod(
            new SabreRequest('PUT', '/files/users/bob/dav-upload.bin'),
            new SabreResponse(201),
        );

        $changes = $this->jmap([
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $state], 'c0'],
        ])->assertOk();
        $this->assertCount(1, $changes->json('methodResponses.0.1.created'));
    }

    public function test_pruned_tombstones_invalidate_old_states(): void
    {
        $this->seedPrivateFile('bob', 'ephemeral.txt');
        $nodes = $this->getAll();
        $fileId = $this->nodeIdByName($nodes, 'ephemeral.txt');
        $oldState = '0';

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$fileId]], 'c0'],
        ])->assertOk();

        // Age the tombstone past the retention window and prune.
        JmapFileNode::query()->whereNotNull('deleted_at')
            ->update(['deleted_at' => now()->subDays(40)]);
        app(FileNodeIndexService::class)->pruneTombstones(30);

        $this->jmap([
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $oldState], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
    }
}
