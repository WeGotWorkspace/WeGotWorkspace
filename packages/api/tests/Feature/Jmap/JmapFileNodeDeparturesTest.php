<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapFileNode;
use App\Models\JmapFileNodeDeparture;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeRelocator;
use App\Services\Jmap\FileNodes\FileNodeSyncState;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2036: a node that moves out of a caller's sight is `destroyed` in that
 * caller's FileNode/changes (RFC 8620 §5.2). alice and bob share the `team`
 * folder; alice's personal Trash is hers alone.
 */
final class JmapFileNodeDeparturesTest extends WgwDatabaseTestCase
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
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor($username))->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    /** @return array<string, mixed> the FileNode/changes response arguments */
    private function changesFor(string $username, string $sinceState): array
    {
        return (array) $this->jmapAs($username, [
            ['FileNode/changes', ['accountId' => $username, 'sinceState' => $sinceState], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
    }

    /**
     * Lists the account so the index has its roots and the team folder's children.
     *
     * @return array<string, string> node ids keyed by name
     */
    private function nodeIdsByName(string $username): array
    {
        $list = $this->jmapAs($username, [
            ['FileNode/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        return array_column((array) $list, 'id', 'name');
    }

    private function nodeAt(string $key): JmapFileNode
    {
        $node = app(FileNodeIndexService::class)->liveByKey($key);
        $this->assertNotNull($node, 'No live node at '.$key);

        return $node;
    }

    public function test_team_doc_moved_to_owner_trash_is_destroyed_for_teammate(): void
    {
        $this->seedGroupFile('x.md', '# Team doc');
        $docId = $this->nodeIdsByName('bob')['x.md'];
        $aliceIds = $this->nodeIdsByName('alice');
        $bobState = app(FileNodeSyncState::class)->current('bob');
        $aliceState = app(FileNodeSyncState::class)->current('alice');

        $trashId = $this->jmapAs('alice', [
            ['FileNode/set', ['accountId' => 'alice', 'create' => [
                't0' => ['parentId' => $aliceIds['alice'], 'name' => '.Trash'],
            ]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.t0.id');
        $this->jmapAs('alice', [
            ['FileNode/set', ['accountId' => 'alice', 'update' => [
                $docId => ['parentId' => $trashId],
            ]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$docId, null);
        $this->assertTrue(app(WgwStorage::class)->files()->fileExists('users/alice/.Trash/x.md'));

        $bob = $this->changesFor('bob', $bobState);
        $this->assertSame([$docId], $bob['destroyed']);
        $this->assertNotContains($docId, $bob['updated']);
        $this->assertNotContains($docId, $bob['created']);

        $alice = $this->changesFor('alice', $aliceState);
        $this->assertContains($docId, $alice['updated']);
        $this->assertNotContains($docId, $alice['destroyed']);

        // carol never saw the team folder: nothing to report.
        $carolState = app(FileNodeSyncState::class)->current('carol');
        $this->assertSame([], $this->changesFor('carol', $carolState)['destroyed']);
    }

    public function test_trashed_team_folder_destroys_its_subtree_for_teammate(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('groups/team/Plans/a.md', 'a');
        $disk->put('groups/team/Plans/Q3/b.md', 'b');
        $index = app(FileNodeIndexService::class);
        $index->recordCreate('groups/team/Plans/Q3/b.md');
        $index->recordCreate('groups/team/Plans/a.md');
        $folder = $this->nodeAt('groups/team/Plans');
        $expected = [
            (string) $folder->node_id,
            (string) $this->nodeAt('groups/team/Plans/a.md')->node_id,
            (string) $this->nodeAt('groups/team/Plans/Q3')->node_id,
            (string) $this->nodeAt('groups/team/Plans/Q3/b.md')->node_id,
        ];
        $bobState = app(FileNodeSyncState::class)->current('bob');

        app(FileNodeRelocator::class)->trashForOwner($folder, 'alice');

        $bob = $this->changesFor('bob', $bobState);
        $destroyed = $bob['destroyed'];
        sort($destroyed);
        sort($expected);
        $this->assertSame($expected, $destroyed);
        $this->assertSame([], $bob['updated']);
    }

    public function test_rename_inside_team_folder_stays_updated_for_teammate(): void
    {
        $this->seedGroupFile('draft.md');
        $docId = $this->nodeIdsByName('bob')['draft.md'];
        $bobState = app(FileNodeSyncState::class)->current('bob');

        $this->jmapAs('alice', [
            ['FileNode/set', ['accountId' => 'alice', 'update' => [
                $docId => ['name' => 'final.md'],
            ]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$docId, null);

        $bob = $this->changesFor('bob', $bobState);
        $this->assertSame([$docId], $bob['updated']);
        $this->assertSame([], $bob['destroyed']);
    }

    public function test_doc_created_and_trashed_inside_the_window_is_omitted(): void
    {
        $this->nodeIdsByName('bob');
        $bobState = app(FileNodeSyncState::class)->current('bob');
        $this->seedGroupFile('brief.md');
        app(FileNodeIndexService::class)->recordCreate('groups/team/brief.md');

        app(FileNodeRelocator::class)->trashForOwner($this->nodeAt('groups/team/brief.md'), 'alice');

        $bob = $this->changesFor('bob', $bobState);
        $this->assertSame([], $bob['created']);
        $this->assertSame([], $bob['destroyed']);
    }

    public function test_pruned_departures_invalidate_old_states(): void
    {
        $this->seedGroupFile('old.md');
        $this->nodeIdsByName('bob');
        $oldState = app(FileNodeSyncState::class)->current('bob');

        app(FileNodeRelocator::class)->trashForOwner($this->nodeAt('groups/team/old.md'), 'alice');
        $afterMove = app(FileNodeSyncState::class)->current('bob');
        $this->assertSame(1, JmapFileNodeDeparture::query()->count());

        // Age the departure past the retention window and prune.
        JmapFileNodeDeparture::query()->update(['created_at' => now()->subDays(40)]);
        app(FileNodeIndexService::class)->pruneTombstones(30);
        $this->assertSame(0, JmapFileNodeDeparture::query()->count());

        $this->jmapAs('bob', [
            ['FileNode/changes', ['accountId' => 'bob', 'sinceState' => $oldState], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
        $this->assertSame([], $this->changesFor('bob', $afterMove)['destroyed']);
    }
}
