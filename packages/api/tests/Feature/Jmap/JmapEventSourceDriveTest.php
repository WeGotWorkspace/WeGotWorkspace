<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeRootMarkers;
use Illuminate\Support\Facades\Cache;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithFileNodeJmap;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `FileNode` push state (#1660): a change marker per Drive root. The hash
 * covers the user's `root → marker` pairs, so a write in someone else's
 * root pushes nothing, while the pushed value stays the global sequence
 * that `FileNode/changes` expects.
 *
 * Fixtures: bob and alice are in group `team`, carol is not; alice is admin.
 */
final class JmapEventSourceDriveTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithFileNodeJmap;
    use InteractsWithJmapEventSource;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        Cache::flush();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_the_pushed_value_is_the_state_file_node_get_returns(): void
    {
        $getState = $this->fileNodeJmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $pushed = $this->changedStates($this->readEventSource($this->userBearerToken(), 'FileNode'), 'bob');

        $this->assertSame(['FileNode' => $getState], $pushed);
        $this->assertSame((string) app(FileNodeIndexService::class)->currentSeq(), $getState);
    }

    public function test_a_write_in_another_users_root_pushes_nothing(): void
    {
        $bob = $this->readEventSource($this->userBearerToken(), 'FileNode');
        $seqBefore = app(FileNodeIndexService::class)->currentSeq();

        $this->createDriveDirectory('/users/carol', 'Private');
        $this->createDriveFile('carol', '/users/carol/Private', 'diary.md');

        // The global sequence moved, bob's hash did not.
        $this->assertGreaterThan($seqBefore, app(FileNodeIndexService::class)->currentSeq());
        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->userBearerToken(), 'FileNode', $bob['id'])->getContent());
    }

    public function test_a_write_in_a_shared_folder_reaches_the_sharee_and_file_node_changes_accepts_the_value(): void
    {
        $this->createDriveDirectory('/users/alice', 'Projects');
        $this->shareFolder('/users/alice/Projects', 'bob');
        $bob = $this->readEventSource($this->userBearerToken(), 'FileNode');
        $carol = $this->readEventSource($this->carolBearerToken(), 'FileNode');
        $sinceState = $this->changedStates($bob, 'bob')['FileNode'];

        $this->createDriveFile('alice', '/users/alice/Projects', 'plan.md');

        $after = $this->changedStates($this->readEventSource($this->userBearerToken(), 'FileNode', $bob['id']), 'bob');
        $this->assertSame(['FileNode' => (string) app(FileNodeIndexService::class)->currentSeq()], $after);

        $changes = $this->fileNodeJmap([
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $sinceState], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame($after['FileNode'], $changes['newState']);
        $this->assertCount(1, $changes['created']);

        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->carolBearerToken(), 'FileNode', $carol['id'])->getContent());
    }

    public function test_sharing_an_empty_folder_changes_the_sharee_state(): void
    {
        $this->createDriveDirectory('/users/alice', 'Empty');
        $bob = $this->readEventSource($this->userBearerToken(), 'FileNode');

        $this->shareFolder('/users/alice/Empty', 'bob');

        // No write ever touched the share root: its marker row does not exist and counts as 0.
        $this->assertSame(['users/alice/Empty' => 0], app(FileNodeRootMarkers::class)->markersFor(['users/alice/Empty']));
        $this->assertSame(
            ['FileNode'],
            array_keys($this->changedStates($this->readEventSource($this->userBearerToken(), 'FileNode', $bob['id']), 'bob')),
        );
    }

    public function test_revoking_a_share_changes_the_sharee_state(): void
    {
        $this->createDriveDirectory('/users/alice', 'Projects');
        $shareId = $this->shareFolder('/users/alice/Projects', 'bob');
        $bob = $this->readEventSource($this->userBearerToken(), 'FileNode');

        $this->withBearer($this->issueBearerTokenFor('alice'))->deleteJson('/api/v1/files/shares/'.$shareId)->assertSuccessful();

        $this->assertSame(
            ['FileNode'],
            array_keys($this->changedStates($this->readEventSource($this->userBearerToken(), 'FileNode', $bob['id']), 'bob')),
        );
    }

    public function test_a_group_folder_write_reaches_members_only(): void
    {
        $bob = $this->readEventSource($this->userBearerToken(), 'FileNode');
        $carol = $this->readEventSource($this->carolBearerToken(), 'FileNode');

        $this->assertSame('Created', app(DriveService::class)->createItem(
            $this->drivePrincipal('alice'),
            'agenda.md',
            'file',
            '/groups/team',
        ));

        $this->assertSame(
            ['FileNode'],
            array_keys($this->changedStates($this->readEventSource($this->userBearerToken(), 'FileNode', $bob['id']), 'bob')),
        );
        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->carolBearerToken(), 'FileNode', $carol['id'])->getContent());
    }

    public function test_moving_a_file_out_of_a_share_reaches_the_sharee(): void
    {
        $this->createDriveDirectory('/users/alice', 'Projects');
        $this->createDriveFile('alice', '/users/alice/Projects', 'draft.md');
        $this->shareFolder('/users/alice/Projects', 'bob');
        $bob = $this->readEventSource($this->userBearerToken(), 'FileNode');

        app(DriveService::class)->movePath($this->drivePrincipal('alice'), '/users/alice/Projects/draft.md', '/users/alice/draft.md');

        $this->assertSame(
            ['FileNode'],
            array_keys($this->changedStates($this->readEventSource($this->userBearerToken(), 'FileNode', $bob['id']), 'bob')),
        );
    }

    public function test_deleting_a_folder_reaches_the_grantee_of_a_share_inside_it(): void
    {
        $this->createDriveDirectory('/users/alice', 'Outer');
        $this->createDriveDirectory('/users/alice/Outer', 'Inner');
        $this->shareFolder('/users/alice/Outer/Inner', 'bob');
        $markers = app(FileNodeRootMarkers::class);
        $before = $markers->markersFor(['users/alice/Outer/Inner']);

        $this->assertSame('Deleted', app(DriveService::class)->deleteItems(
            $this->drivePrincipal('alice'),
            [['path' => '/users/alice/Outer', 'type' => 'dir']],
        ));

        $this->assertSame($before['users/alice/Outer/Inner'] + 1, $markers->markersFor(['users/alice/Outer/Inner'])['users/alice/Outer/Inner']);
    }

    public function test_one_write_bumps_the_account_root_and_each_ancestor_share_root_once(): void
    {
        $this->createDriveDirectory('/users/alice', 'Projects');
        $this->createDriveDirectory('/users/alice/Projects', 'Sub');
        $this->createDriveDirectory('/users/alice', 'Other');
        $this->shareFolder('/users/alice/Projects', 'bob');
        $this->shareFolder('/users/alice/Projects/Sub', 'carol');
        $this->shareFolder('/users/alice/Other', 'carol');
        $roots = ['users/alice', 'users/alice/Projects', 'users/alice/Projects/Sub', 'users/alice/Other', 'users/bob'];
        $markers = app(FileNodeRootMarkers::class);
        $before = $markers->markersFor($roots);

        $this->createDriveFile('alice', '/users/alice/Projects/Sub', 'notes.md');

        $after = $markers->markersFor($roots);
        $this->assertSame($before['users/alice'] + 1, $after['users/alice']);
        $this->assertSame($before['users/alice/Projects'] + 1, $after['users/alice/Projects']);
        $this->assertSame($before['users/alice/Projects/Sub'] + 1, $after['users/alice/Projects/Sub']);
        $this->assertSame($before['users/alice/Other'], $after['users/alice/Other']);
        $this->assertSame($before['users/bob'], $after['users/bob']);
    }

    public function test_a_batch_set_bumps_each_root_once(): void
    {
        $this->createDriveDirectory('/users/alice', 'Projects');
        $this->shareFolder('/users/alice/Projects', 'bob');
        $alice = $this->issueBearerTokenFor('alice');
        $nodes = $this->fileNodeGetAll('alice', $alice);
        $projects = $this->fileNodeIdByName($nodes, 'Projects');
        $home = $this->fileNodeIdByName($nodes, 'alice');
        $roots = ['users/alice', 'users/alice/Projects'];
        $markers = app(FileNodeRootMarkers::class);
        $before = $markers->markersFor($roots);

        $created = $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'create' => [
                'a' => ['parentId' => $projects, 'name' => 'a.md', 'blobId' => $this->uploadFileNodeBlob('a', 'alice', $alice)],
                'b' => ['parentId' => $projects, 'name' => 'b.md', 'blobId' => $this->uploadFileNodeBlob('b', 'alice', $alice)],
                'c' => ['parentId' => $projects, 'name' => 'c.md', 'blobId' => $this->uploadFileNodeBlob('c', 'alice', $alice)],
            ]], 'c0'],
        ], $alice)->assertOk()->json('methodResponses.0.1.created');
        $this->assertCount(3, $created);
        $afterCreate = $markers->markersFor($roots);
        $this->assertSame($before['users/alice'] + 1, $afterCreate['users/alice']);
        $this->assertSame($before['users/alice/Projects'] + 1, $afterCreate['users/alice/Projects']);

        // Batch move of all three out of the share: each root once more.
        $update = [];
        foreach ($created as $node) {
            $update[$node['id']] = ['parentId' => $home];
        }
        $this->fileNodeJmap([
            ['FileNode/set', ['accountId' => 'alice', 'update' => $update], 'c1'],
        ], $alice)->assertOk();
        $afterMove = $markers->markersFor($roots);
        $this->assertSame($afterCreate['users/alice'] + 1, $afterMove['users/alice']);
        $this->assertSame($afterCreate['users/alice/Projects'] + 1, $afterMove['users/alice/Projects']);
    }

    public function test_keys_outside_the_drive_trees_have_no_root(): void
    {
        $markers = app(FileNodeRootMarkers::class);

        $this->assertSame([], $markers->rootsForKey('tmp/upload/x'));
        $this->assertSame([], $markers->rootsForKey('users'));
        $this->assertSame(['users/alice'], $markers->rootsForKey('users/alice'));
        $this->assertSame(['groups/team'], $markers->rootsForKey('groups/team/a/b/c.md'));
    }

    private function shareFolder(string $path, string $grantee): string
    {
        return (string) $this->withBearer($this->issueBearerTokenFor('alice'))->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [$grantee => ['access' => 'view']],
        ])->assertOk()->json('data.id');
    }
}
