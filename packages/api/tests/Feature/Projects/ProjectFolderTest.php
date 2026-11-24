<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\WebdavWriteGuardPlugin;
use App\Exceptions\ApiHttpException;
use App\Models\JmapFileNode;
use App\Models\ProjectResource;
use App\Services\Drive\DriveService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Projects\ProjectFolder;
use App\Services\Projects\ProjectKind;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception\Forbidden;
use Sabre\DAV\Server;
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

    public function test_the_default_project_has_a_top_level_folder_like_any_other(): void
    {
        $default = $this->listProjects('dave')->assertOk()->json('list.0');

        $this->assertTrue($default['isDefault']);
        $this->assertSame('/groups/t1/T1 Project', $default['resources']['driveFolderPath']);
        $node = JmapFileNode::query()->where('node_id', $default['resources']['driveFolderId'])->firstOrFail();
        $this->assertSame('groups/t1/T1 Project', $node->storage_key);
        $this->assertTrue((bool) $node->is_dir);
        $this->assertSame(
            $default['resources']['driveFolderId'],
            ProjectResource::query()->where('project_id', $default['id'])->where('kind', ProjectKind::DriveFolder->value)->value('locator'),
        );
    }

    public function test_renaming_the_default_project_renames_its_folder(): void
    {
        $default = $this->listProjects('dave')->assertOk()->json('list.0');

        $patched = $this->asUser('bob')->patchJson('/api/v1/projects/'.$default['id'], ['name' => 'Everything'])->assertOk()->json();

        $this->assertSame($default['resources']['driveFolderId'], $patched['resources']['driveFolderId']);
        $this->assertSame('/groups/t1/Everything', $patched['resources']['driveFolderPath']);
        $this->assertTrue($this->files()->directoryExists('groups/t1/Everything'));
    }

    public function test_the_default_projects_folder_cannot_be_removed_by_a_client(): void
    {
        $default = $this->listProjects('dave')->assertOk()->json('list.0');
        $folderId = (string) $default['resources']['driveFolderId'];

        $response = $this->fileNodes('bob', [['FileNode/set', ['accountId' => 'bob', 'destroy' => [$folderId]], 's']]);

        $this->assertArrayHasKey($folderId, $response->json('methodResponses.0.1.notDestroyed') ?? []);
        $this->assertTrue($this->files()->directoryExists('groups/t1/T1 Project'));
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
        $guard->initialize(new Server([]));
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

        // A MOVE or COPY onto the folder would overwrite it, so the destination is refused too.
        foreach (['MOVE', 'COPY'] as $method) {
            $onto = new SabreRequest($method, '/files/groups/t1/Scratch');
            $onto->setHeader('Destination', '/files/groups/t1/Launch');
            try {
                $guard->beforeMethod($onto, new SabreResponse);
                $this->fail($method.' onto the Project folder must be refused.');
            } catch (Forbidden $e) {
                $this->assertStringContainsString('Project folder', $e->getMessage());
            }
        }
        try {
            $guard->beforeUnbind('files/groups/t1/Launch');
            $this->fail('Unbinding the Project folder must be refused.');
        } catch (Forbidden) {
            $this->addToAssertionCount(1);
        }

        // Inside the folder, and a sibling folder, DAV works as before.
        $guard->beforeMethod(new SabreRequest('DELETE', '/files/groups/t1/Launch/notes.txt'), new SabreResponse);
        $guard->beforeMethod(new SabreRequest('DELETE', '/files/groups/t1/Launch/Drafts'), new SabreResponse);
        $guard->beforeMethod(new SabreRequest('DELETE', '/files/groups/t1/Other'), new SabreResponse);
        $this->addToAssertionCount(1);
    }

    public function test_doubled_slashes_do_not_get_past_the_dav_guards(): void
    {
        $this->createProject('bob', 't1', 'Launch');
        $guard = app(WebdavWriteGuardPlugin::class);
        $guard->initialize(new Server([]));

        foreach (['/files/groups/t1///Launch', '/files//groups/t1/Launch', '/files/groups//t1', '/files/users///bob'] as $path) {
            $delete = new SabreRequest('DELETE', $path);
            $move = new SabreRequest('MOVE', $path);
            $move->setHeader('Destination', '/files/groups/t1/Renamed');
            foreach ([$delete, $move] as $request) {
                try {
                    $guard->beforeMethod($request, new SabreResponse);
                    $this->fail($request->getMethod().' '.$path.' must be refused.');
                } catch (Forbidden) {
                    $this->addToAssertionCount(1);
                }
            }
        }
    }

    public function test_a_long_cjk_name_still_gets_a_folder(): void
    {
        $name = str_repeat('漢', 100);
        $this->createProject('bob', 't1', $name);
        $folder = ProjectFolder::folderName($name);
        $this->assertLessThanOrEqual(200, strlen($folder));
        $this->assertTrue(mb_check_encoding($folder, 'UTF-8'));
        $this->assertTrue($this->files()->directoryExists('groups/t1/'.$folder));
    }

    public function test_drive_service_cannot_rename_or_delete_the_folder_itself(): void
    {
        $this->createProject('bob', 't1', 'Launch');
        $this->files()->put('groups/t1/Launch/notes.txt', 'x');
        $drive = app(DriveService::class);
        $bob = ['username' => 'bob', 'role' => 'user'];

        foreach ([
            fn () => $drive->renameItem($bob, '/groups/t1', 'Launch', 'Other'),
            fn () => $drive->deleteItems($bob, [['path' => '/groups/t1/Launch']]),
        ] as $call) {
            try {
                $call();
                $this->fail('The Project folder must be refused.');
            } catch (ApiHttpException $e) {
                $this->assertSame('project_folder', $e->errorCode());
            }
        }
        $this->assertTrue($this->files()->directoryExists('groups/t1/Launch'));

        // Inside the folder, Drive works as before.
        $drive->renameItem($bob, '/groups/t1/Launch', 'notes.txt', 'plan.txt');
        $drive->deleteItems($bob, [['path' => '/groups/t1/Launch/plan.txt']]);
        $this->assertFalse($this->files()->fileExists('groups/t1/Launch/plan.txt'));
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
