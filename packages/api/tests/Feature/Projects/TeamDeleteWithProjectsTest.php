<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\WebdavWriteGuardPlugin;
use App\Models\CalendarInstance;
use App\Models\JmapFileNode;
use App\Models\Project;
use App\Models\ProjectMarker;
use App\Models\ProjectResource;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Sabre\DAV\Exception\Forbidden;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #819 B3: Team delete removes every Project of the Team, live or archived, and the
 * Admin state names how many there are, so the confirmation can say so.
 */
final class TeamDeleteWithProjectsTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_team_delete_removes_every_project_of_the_team_and_says_how_many(): void
    {
        $this->listProjects('dave')->assertOk(); // the default Project of T1
        $live = $this->createProject('bob', 't1', 'Launch');
        $archived = $this->createProject('bob', 't1', 'Old');
        Project::query()->whereKey($archived['id'])->update(['archived_at' => now()]);
        $other = $this->createProject('carol', 't2', 'Elsewhere');

        $groups = collect($this->asUser('alice')->getJson('/api/v1/admin/state')->assertOk()->json('groups'))->keyBy('name');
        $this->assertSame(3, $groups['t1']['projectCount']);
        $this->assertSame(1, $groups['t2']['projectCount'], 'T2 has its new Project only; its default comes on first read.');

        $this->asUser('alice')->deleteJson('/api/v1/admin/groups/t1')
            ->assertOk()
            ->assertJsonPath('deletedProjects', 3);

        $this->assertSame([$other['id']], Project::query()->pluck('id')->all());
        $this->assertSame(0, ProjectResource::query()->whereIn('project_id', [$live['id'], $archived['id']])->count());
        $this->assertNull(ProjectMarker::query()->find('t1'));
        $this->assertSame(0, CalendarInstance::query()->where('principaluri', 'principals/groups/t1')->count());
        $this->assertFalse(app(WgwStorage::class)->files()->directoryExists('groups/t1/Launch'));
        $this->asUser('carol')->getJson('/api/v1/projects/'.$other['id'])->assertOk();
    }

    public function test_a_team_made_again_with_the_same_slug_starts_without_projects(): void
    {
        $this->createProject('bob', 't1', 'Launch');
        $this->asUser('alice')->deleteJson('/api/v1/admin/groups/t1')->assertOk();

        $this->asUser('alice')->postJson('/api/v1/admin/groups', ['name' => 't1', 'displayName' => 'T1 again'])->assertSuccessful();

        $this->assertSame(['T1 again Project'], Project::query()->where('group_slug', 't1')->pluck('name')->all());
    }

    public function test_a_client_cannot_delete_rename_or_move_the_team_drive_root(): void
    {
        $guard = app(WebdavWriteGuardPlugin::class);
        $move = new SabreRequest('MOVE', '/files/groups/t1');
        $move->setHeader('Destination', '/files/groups/t1-copy');
        foreach ([new SabreRequest('DELETE', '/files/groups/t1'), $move, new SabreRequest('DELETE', '/files/users/bob')] as $request) {
            try {
                $guard->beforeMethod($request, new SabreResponse);
                $this->fail($request->getMethod().' '.$request->getPath().' must be refused.');
            } catch (Forbidden) {
                $this->addToAssertionCount(1);
            }
        }

        app(WgwStorage::class)->files()->makeDirectory('groups/t1');
        app(FileNodeIndexService::class)->ensureRootsIndexed('bob', ['t1']);
        $root = JmapFileNode::query()->where('storage_key', 'groups/t1')->firstOrFail();
        $rights = $this->asUser('bob')->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/get', ['accountId' => 'bob', 'ids' => [$root->node_id]], 'g']],
        ])->assertOk()->json('methodResponses.0.1.list.0.myRights');
        $this->assertIsArray($rights);
        $set = $this->asUser('bob')->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [
                ['FileNode/set', ['accountId' => 'bob', 'update' => [$root->node_id => ['name' => 'renamed']]], 'u'],
                ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$root->node_id], 'onDestroyRemoveChildren' => true], 'd'],
            ],
        ])->json('methodResponses');
        $this->assertSame('forbidden', $set[0][1]['notUpdated'][$root->node_id]['type'] ?? null);
        $this->assertSame('forbidden', $set[1][1]['notDestroyed'][$root->node_id]['type'] ?? null);
        $this->assertTrue(app(WgwStorage::class)->files()->directoryExists('groups/t1'));
        $this->assertFalse($rights['mayRename']);
        $this->assertFalse($rights['mayDelete']);
    }
}
