<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\WebdavWriteGuardPlugin;
use App\Models\JmapFileNode;
use App\Models\ProjectResource;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Projects\ProjectKind;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception\Forbidden;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #817 A3: the Project folder in the Team Drive. It follows the Project's name, is
 * registered by node id, and cannot be renamed, moved or deleted on its own over JMAP
 * or DAV. Everything inside it is an ordinary file or folder.
 */
final class ProjectFolderTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_create_makes_the_folder_and_a_name_clash_gets_a_suffix(): void
    {
        $this->files()->makeDirectory('groups/t1/Launch');

        $project = $this->createProject('bob', 't1', 'Launch');

        $this->assertSame('/groups/t1/Launch (2)', $project['resources']['driveFolderPath']);
        $this->assertTrue($this->files()->directoryExists('groups/t1/Launch (2)'));
        $node = JmapFileNode::query()->where('node_id', $project['resources']['driveFolderId'])->firstOrFail();
        $this->assertSame('groups/t1/Launch (2)', $node->storage_key);
        $this->assertTrue((bool) $node->is_dir);

        // A name that would hide the folder or leave the Team Drive is cleaned.
        $this->assertSame('/groups/t1/a-b', $this->createProject('bob', 't1', '..a/b')['resources']['driveFolderPath']);
    }

    public function test_rename_follows_the_project_and_keeps_node_ids(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $this->files()->put('groups/t1/Launch/plan.md', '# Plan');
        $file = app(FileNodeIndexService::class)->recordCreate('groups/t1/Launch/plan.md');
        $this->assertNotNull($file);

        $patched = $this->asUser('bob')->patchJson('/api/v1/projects/'.$project['id'], ['name' => 'Big launch'])->assertOk()->json();

        $this->assertSame($project['resources']['driveFolderId'], $patched['resources']['driveFolderId']);
        $this->assertSame('/groups/t1/Big launch', $patched['resources']['driveFolderPath']);
        $this->assertSame('# Plan', $this->files()->get('groups/t1/Big launch/plan.md'));
        $this->assertSame(
            'groups/t1/Big launch/plan.md',
            JmapFileNode::query()->where('node_id', $file->node_id)->value('storage_key'),
        );
    }

    public function test_ensure_makes_a_missing_folder_again(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $this->files()->deleteDirectory('groups/t1/Launch');
        app(FileNodeIndexService::class)->recordDelete('groups/t1/Launch');

        $listed = collect($this->listProjects('dave')->assertOk()->json('list'))->firstWhere('id', $project['id']);

        $this->assertIsArray($listed);
        $this->assertSame('/groups/t1/Launch', $listed['resources']['driveFolderPath']);
        $this->assertNotSame($project['resources']['driveFolderId'], $listed['resources']['driveFolderId']);
        $this->assertTrue($this->files()->directoryExists('groups/t1/Launch'));
        $this->assertSame(
            $listed['resources']['driveFolderId'],
            ProjectResource::query()->where('project_id', $project['id'])->where('kind', ProjectKind::DriveFolder->value)->value('locator'),
        );
    }

    public function test_the_default_project_has_no_folder(): void
    {
        $default = $this->listProjects('dave')->assertOk()->json('list.0');

        $this->assertTrue($default['isDefault']);
        $this->assertNull($default['resources']['driveFolderId']);
        $this->assertNull($default['resources']['driveFolderPath']);
    }

    public function test_file_node_set_cannot_rename_move_or_destroy_the_folder_itself(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $folderId = (string) $project['resources']['driveFolderId'];
        $this->files()->makeDirectory('groups/t1/Elsewhere');
        $elsewhere = app(FileNodeIndexService::class)->recordCreate('groups/t1/Elsewhere');
        $this->assertNotNull($elsewhere);
        $this->files()->put('groups/t1/Launch/plan.md', '# Plan');
        $file = app(FileNodeIndexService::class)->recordCreate('groups/t1/Launch/plan.md');
        $this->assertNotNull($file);

        $rights = $this->fileNodes('bob', [['FileNode/get', ['accountId' => 'bob', 'ids' => [$folderId, $file->node_id]], 'g']])
            ->json('methodResponses.0.1.list');
        $byId = collect($rights)->keyBy('id');
        $this->assertFalse($byId[$folderId]['myRights']['mayRename']);
        $this->assertFalse($byId[$folderId]['myRights']['mayDelete']);
        $this->assertTrue($byId[$folderId]['myRights']['mayAddChildren']);
        $this->assertTrue($byId[$file->node_id]['myRights']['mayRename']);

        $set = $this->fileNodes('bob', [
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$folderId => ['name' => 'Mine']]], 'u1'],
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$folderId => ['parentId' => $elsewhere->node_id]]], 'u2'],
            ['FileNode/set', ['accountId' => 'bob', 'destroy' => [$folderId], 'onDestroyRemoveChildren' => true], 'd'],
            ['FileNode/set', ['accountId' => 'bob', 'update' => [$file->node_id => ['name' => 'plan-v2.md']]], 'ok'],
        ]);

        $this->assertSame('forbidden', $set->json('methodResponses.0.1.notUpdated.'.$folderId.'.type'));
        $this->assertSame('forbidden', $set->json('methodResponses.1.1.notUpdated.'.$folderId.'.type'));
        $this->assertSame('forbidden', $set->json('methodResponses.2.1.notDestroyed.'.$folderId.'.type'));
        $this->assertArrayHasKey($file->node_id, $set->json('methodResponses.3.1.updated') ?? []);
        $this->assertTrue($this->files()->fileExists('groups/t1/Launch/plan-v2.md'));
    }

    public function test_dav_cannot_delete_or_move_the_folder_itself(): void
    {
        $this->createProject('bob', 't1', 'Launch');
        $guard = app(WebdavWriteGuardPlugin::class);
        $move = new SabreRequest('MOVE', '/files/groups/t1/Launch');
        $move->setHeader('Destination', '/files/groups/t1/Other');

        foreach ([new SabreRequest('DELETE', '/files/groups/t1/Launch'), $move] as $request) {
            try {
                $guard->beforeMethod($request, new SabreResponse);
                $this->fail($request->getMethod().' of the Project folder must be refused.');
            } catch (Forbidden $e) {
                $this->assertStringContainsString('Project folder', $e->getMessage());
            }
        }

        // Inside the folder, and a sibling folder, DAV works as before.
        $guard->beforeMethod(new SabreRequest('DELETE', '/files/groups/t1/Launch/notes.txt'), new SabreResponse);
        $guard->beforeMethod(new SabreRequest('DELETE', '/files/groups/t1/Launch/Drafts'), new SabreResponse);
        $guard->beforeMethod(new SabreRequest('DELETE', '/files/groups/t1/Other'), new SabreResponse);
        $this->addToAssertionCount(1);
    }

    /** @param list<array{0: string, 1: array<string, mixed>, 2: string}> $calls */
    private function fileNodes(string $username, array $calls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $calls,
        ])->assertOk();
    }

    private function files(): Filesystem
    {
        return app(WgwStorage::class)->files();
    }
}
