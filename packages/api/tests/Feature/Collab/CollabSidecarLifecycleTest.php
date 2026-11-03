<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeReindexer;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The Yjs sidecar follows the document on REST and JMAP rename/move/delete.
 * A same-principal rename is the common case and must not be skipped.
 */
final class CollabSidecarLifecycleTest extends WgwDatabaseTestCase
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

    public function test_rest_rename_in_the_same_folder_moves_the_sidecar(): void
    {
        $this->seedDocument('users/bob/together.md');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            '/users/bob/together.md',
            'renamed.md',
        ));

        $disk = Storage::disk('wgw_files');
        $this->assertSame('history', $disk->get('users/bob/.renamed.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));
    }

    public function test_rest_move_to_trash_moves_the_sidecar(): void
    {
        $this->seedDocument('users/bob/together.md');
        $this->ensureTrashDirectory($this->userBearerToken(), 'bob');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/together.md',
            'together.md',
        ));

        $disk = Storage::disk('wgw_files');
        $this->assertSame('history', $disk->get('users/bob/.Trash/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));
    }

    public function test_rest_trash_collision_follows_the_unique_name(): void
    {
        $disk = Storage::disk('wgw_files');
        $this->ensureTrashDirectory($this->userBearerToken(), 'bob');
        $disk->put('users/bob/.Trash/together.md', 'already there');
        $this->seedDocument('users/bob/together.md');

        app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/.Trash',
            '/users/bob/together.md',
            'together.md',
        );

        $this->assertSame('history', $disk->get('users/bob/.Trash/.together 2.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.Trash/.together.md.yjs'));
    }

    public function test_rest_move_across_principals_moves_the_sidecar(): void
    {
        $this->seedDocument('users/bob/together.md');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/groups/team',
            '/users/bob/together.md',
            'together.md',
        ));

        $disk = Storage::disk('wgw_files');
        $this->assertSame('history', $disk->get('groups/team/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));
    }

    public function test_rest_delete_removes_the_sidecar_and_leaves_another_orphan(): void
    {
        $disk = Storage::disk('wgw_files');
        $this->seedDocument('users/bob/together.md');
        $disk->put('users/bob/.other.md.yjs', 'orphan');

        $this->assertSame('Deleted', app(DriveService::class)->deleteItems(
            $this->drivePrincipal('bob'),
            [['path' => '/users/bob/together.md']],
        ));

        $this->assertFalse($disk->exists('users/bob/together.md'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));
        $this->assertSame('orphan', $disk->get('users/bob/.other.md.yjs'));
    }

    public function test_rest_directory_move_carries_the_nested_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $this->createDriveDirectory('/users/bob', 'notes');
        $disk->put('users/bob/notes/together.md', '# doc');
        $disk->put('users/bob/notes/.together.md.yjs', 'history');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob',
            '/users/bob/notes',
            'renamed-notes',
        ));

        $this->assertSame('history', $disk->get('users/bob/renamed-notes/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/notes/.together.md.yjs'));
    }

    public function test_jmap_rename_and_destroy_follow_the_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $this->seedDocument('users/bob/together.md');
        $id = $this->nodeId('users/bob/together.md');

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$id => ['name' => 'renamed.md']]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$id, null);

        $this->assertSame('history', $disk->get('users/bob/.renamed.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));

        $id = $this->nodeId('users/bob/renamed.md');
        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$id]], 'c1'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $id);

        $this->assertFalse($disk->exists('users/bob/renamed.md'));
        $this->assertFalse($disk->exists('users/bob/.renamed.md.yjs'));
    }

    public function test_jmap_move_across_principals_moves_the_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $this->seedDocument('users/bob/together.md');
        app(FileNodeIndexService::class)->ensureRootsIndexed('bob', ['team']);
        $id = $this->nodeId('users/bob/together.md');
        $teamId = $this->nodeId('groups/team');

        $this->jmap([
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$id => ['parentId' => $teamId]]], 'c0'],
        ])->assertOk();

        $this->assertSame('history', $disk->get('groups/team/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/bob/.together.md.yjs'));
    }

    public function test_reindex_leaves_an_already_orphaned_sidecar(): void
    {
        $disk = Storage::disk('wgw_files');
        $this->seedDocument('users/bob/together.md');
        $disk->delete('users/bob/together.md');

        app(FileNodeReindexer::class)->reindexAll();

        $this->assertSame('history', $disk->get('users/bob/.together.md.yjs'));
    }

    private function seedDocument(string $key): void
    {
        $disk = Storage::disk('wgw_files');
        $parent = dirname($key);
        $name = basename($key);
        $virtualParent = '/'.$parent;
        if (! $disk->fileExists($key)) {
            $this->createDriveFile($this->userBearerToken(), $virtualParent, $name);
        }
        $disk->put($this->sidecarKey($key), 'history');
    }

    private function sidecarKey(string $documentKey): string
    {
        $parent = dirname($documentKey);

        return ($parent === '.' ? '' : $parent.'/').'.'.basename($documentKey).'.yjs';
    }

    private function nodeId(string $key): string
    {
        $node = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($node);

        return (string) $node->node_id;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }
}
