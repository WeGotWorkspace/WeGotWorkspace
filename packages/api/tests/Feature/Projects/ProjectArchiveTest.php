<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\WebdavWriteGuardPlugin;
use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\Calendar;
use App\Models\JmapFileNode;
use App\Models\Principal;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Drive\DriveSharePathScope;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Projects\ProjectCollections;
use App\Services\Projects\ProjectKind;
use App\Services\Projects\ProjectLifecycle;
use App\Services\Projects\ProjectService;
use App\Services\Projects\ProjectSlugs;
use App\Storage\StorageKeyClass;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Exception\NotFound;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #819 B2: archive hides a Project's collections and folder from every client, unarchive
 * brings them back with the same ids, purge removes an archived Project for good.
 */
final class ProjectArchiveTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_archive_hides_the_collections_from_every_read_path(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $ids = $project['resources'];
        $task = $this->asUser('dave')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [$ids['taskListId'] => true],
            'title' => 'Book the venue',
        ])->assertCreated()->json('id');

        $archived = $this->archive('bob', $project['id'])->assertOk();
        $archived->assertJsonPath('archived', true)->assertJsonPath('resources.driveFolderPath', null);

        $this->assertNotContains($ids['taskListId'], array_column($this->asUser('dave')->getJson('/api/v1/tasks/tasklists')->json('list'), 'id'));
        $this->asUser('dave')->getJson('/api/v1/tasks/tasklists/'.$ids['taskListId'])->assertNotFound();
        $this->asUser('dave')->getJson('/api/v1/tasks/items/'.$task)->assertNotFound();
        $this->assertNotContains($ids['notebookId'], array_column($this->asUser('dave')->getJson('/api/v1/notes/notebooks')->json('list'), 'id'));
        $this->assertNotContains($ids['channelId'], array_column($this->asUser('dave')->getJson('/api/v1/chat/channels')->json('list'), 'id'));
        $calendars = $this->jmap('dave', JmapCapabilities::CALENDARS, [['Calendar/get', ['accountId' => 'dave'], 'g']])->json('methodResponses.0.1.list');
        $this->assertNotContains($ids['calendarId'], array_column($calendars, 'id'));

        $davUris = array_column(app(WgwCalendarBackendFactory::class)->make()->getCalendarsForUser('principals/groups/t1'), 'uri');
        $this->assertNotContains('prj-launch', $davUris);
        $this->assertContains('t1', $davUris, 'The Team calendar stays.');
        $availability = app(CalendarCollectionAccess::class)->availabilitySourceInstances('dave')['team'];
        $this->assertNotContains('prj-launch', array_map(static fn ($instance): string => (string) $instance->uri, $availability));

        // The list of archived Projects still shows it, for Settings.
        $this->assertContains($project['id'], array_column($this->listProjects('dave', archived: true)->json('list'), 'id'));
        $this->assertNotContains($project['id'], array_column($this->listProjects('dave')->json('list'), 'id'));
    }

    public function test_archive_moves_the_folder_out_of_client_reach_with_its_node_ids(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $folderId = (string) $project['resources']['driveFolderId'];
        $this->files()->put('groups/t1/Launch/plan.md', '# Plan');
        $file = app(FileNodeIndexService::class)->recordCreate('groups/t1/Launch/plan.md');
        $this->assertNotNull($file);

        $this->archive('bob', $project['id'])->assertOk();

        $this->assertTrue($this->files()->fileExists('groups/t1/.project-archive/launch/plan.md'));
        $this->assertFalse($this->files()->directoryExists('groups/t1/Launch'));
        $this->assertSame('groups/t1/.project-archive/launch', JmapFileNode::query()->where('node_id', $folderId)->whereNull('deleted_at')->value('storage_key'));
        $this->assertSame(StorageKeyClass::ProjectArchive, StorageKeyClass::classify('groups/t1/.project-archive/launch/plan.md'));
        $this->assertFalse(StorageKeyClass::ProjectArchive->isSearchIndexed());

        // JMAP: neither the folder nor what is in it.
        $got = $this->jmap('bob', JmapCapabilities::FILENODE, [['FileNode/get', ['accountId' => 'bob', 'ids' => [$folderId, $file->node_id]], 'g']]);
        $this->assertSame([], $got->json('methodResponses.0.1.list'));
        $this->assertEqualsCanonicalizing([$folderId, $file->node_id], $got->json('methodResponses.0.1.notFound'));

        // Nor do the listing paths: get without ids, and a query on the Team root, with parentId or ancestorId.
        $teamRoot = (string) JmapFileNode::query()->where('storage_key', 'groups/t1')->whereNull('deleted_at')->value('node_id');
        $all = $this->jmap('bob', JmapCapabilities::FILENODE, [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']]);
        $this->assertStringNotContainsString('project-archive', (string) json_encode($all->json('methodResponses.0.1.list')));
        $this->assertNotContains($folderId, array_column($all->json('methodResponses.0.1.list'), 'id'));
        foreach ([[], ['parentId' => $teamRoot], ['ancestorId' => $teamRoot]] as $filter) {
            $query = $this->jmap('bob', JmapCapabilities::FILENODE, [['FileNode/query', ['accountId' => 'bob', 'filter' => $filter], 'q']]);
            $ids = $query->json('methodResponses.0.1.ids');
            $this->assertNotContains($folderId, $ids);
            $this->assertNotContains($file->node_id, $ids);
        }

        // REST: not in the Team Drive listing, not found by Drive search.
        $listing = $this->asUser('bob')->getJson('/api/v1/files/children?path='.urlencode('/groups/t1'))->assertOk()->json();
        $this->assertStringNotContainsString('project-archive', (string) json_encode($listing));
        $this->asUser('bob')->getJson('/api/v1/files/children?path='.urlencode('/groups/t1/.project-archive/launch'))->assertNotFound();
        $found = $this->asUser('bob')->getJson('/api/v1/files?search=plan')->assertOk()->json();
        $this->assertStringNotContainsString('plan.md', (string) json_encode($found));

        // Every other Drive path: the path check refuses the tree.
        $this->assertFalse(app(StoragePaths::class)->isPathAllowed('/groups/t1/.project-archive/launch/plan.md', 'bob', ['t1'], false));
        $this->assertTrue(app(DriveSharePathScope::class)->isInert('/groups/t1/.project-archive/launch'));

        // DAV: no method reaches it, reads included.
        foreach (['PROPFIND', 'GET', 'PUT', 'DELETE'] as $method) {
            try {
                app(WebdavWriteGuardPlugin::class)->beforeMethod(new SabreRequest($method, '/files/groups/t1/.project-archive/launch/plan.md'), new SabreResponse);
                $this->fail($method.' must not reach the archive.');
            } catch (NotFound) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_unarchive_brings_back_the_same_ids_and_a_free_folder_name(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $ids = $project['resources'];
        $task = $this->asUser('dave')->postJson('/api/v1/tasks/items', ['taskListIds' => [$ids['taskListId'] => true], 'title' => 'Venue'])->json('id');
        $this->archive('bob', $project['id'])->assertOk();
        $this->files()->makeDirectory('groups/t1/Launch'); // someone took the name meanwhile

        $back = $this->asUser('bob')->postJson('/api/v1/projects/'.$project['id'].'/unarchive')->assertOk();

        $back->assertJsonPath('archived', false);
        $this->assertSame($ids['taskListId'], $back->json('resources.taskListId'));
        $this->assertSame($ids['driveFolderId'], $back->json('resources.driveFolderId'));
        $this->assertSame('/groups/t1/Launch (2)', $back->json('resources.driveFolderPath'));
        $this->asUser('dave')->getJson('/api/v1/tasks/items/'.$task)->assertOk();
        $this->assertContains($ids['channelId'], array_column($this->asUser('dave')->getJson('/api/v1/chat/channels')->json('list'), 'id'));
    }

    public function test_who_may_archive_and_what_cannot_be_archived_or_purged(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $default = $this->listProjects('dave')->json('list.0.id');

        $this->archive('dave', $project['id'])->assertForbidden()->assertJsonPath('code', 'team_admin_only');
        $this->archive('carol', $project['id'])->assertNotFound();
        $this->archive('bob', $default)->assertStatus(409)->assertJsonPath('code', 'default_project');
        // Purge is for organization admins, through the Admin routes; a team admin has none.
        $this->asUser('bob')->deleteJson('/api/v1/admin/projects/'.$project['id'])->assertForbidden();
        $this->asUser('bob')->deleteJson('/api/v1/projects/'.$project['id'])->assertStatus(405);
        $this->joinTeam('alice', 't1');
        $this->asUser('alice')->deleteJson('/api/v1/admin/projects/'.$default)->assertStatus(409)->assertJsonPath('code', 'default_project');
        $this->asUser('alice')->deleteJson('/api/v1/admin/projects/'.$project['id'])->assertStatus(409)->assertJsonPath('code', 'not_archived');
        $this->assertSame(2, Project::query()->where('group_slug', 't1')->whereNull('archived_at')->count());
    }

    public function test_purge_removes_an_archived_project_and_frees_its_slug(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $this->files()->put('groups/t1/Launch/plan.md', '# Plan');
        $calendarIds = ProjectResource::query()->where('project_id', $project['id'])->where('kind', '!=', ProjectKind::DriveFolder->value)->pluck('locator')->all();
        $this->archive('bob', $project['id'])->assertOk();

        // While archived the slug stays reserved.
        $this->assertSame('launch-2', $this->createProject('bob', 't1', 'Launch')['slug']);

        $this->joinTeam('alice', 't1');
        $this->asUser('alice')->deleteJson('/api/v1/admin/projects/'.$project['id'])->assertOk();

        $this->assertNull(Project::query()->find($project['id']));
        $this->assertSame(0, ProjectResource::query()->where('project_id', $project['id'])->count());
        $this->assertSame(0, Calendar::query()->whereIn('id', $calendarIds)->count());
        $this->assertTrue($this->files()->fileExists('users/alice/.Trash/launch/plan.md'), 'The folder lands in the purging admin\'s trash.');
        $this->assertFalse($this->files()->directoryExists('groups/t1/.project-archive/launch'));
        $this->assertSame('launch', app(ProjectSlugs::class)->free('t1', 'Launch'), 'The slug is free again.');
    }

    public function test_an_organization_admin_outside_the_team_cannot_purge_and_gets_no_files(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $this->files()->put('groups/t1/Launch/plan.md', '# Plan');
        $this->archive('bob', $project['id'])->assertOk();

        $this->asUser('alice')->deleteJson('/api/v1/admin/projects/'.$project['id'])->assertNotFound();

        $this->assertNotNull(Project::query()->find($project['id']));
        $this->assertFalse($this->files()->directoryExists('users/alice/.Trash/launch'), 'Nothing lands in the outsider\'s trash.');
        $this->assertTrue($this->files()->fileExists('groups/t1/.project-archive/launch/plan.md'));
    }

    public function test_a_purge_that_failed_half_way_completes_on_retry(): void
    {
        $this->joinTeam('alice', 't1');
        $created = app(ProjectService::class)->create('bob', ['teamSlug' => 't1', 'name' => 'Launch']);
        app(ProjectLifecycle::class)->archive('bob', (string) $created['id']);
        // One stand-in for the whole test: the router keeps the controller from the first request on.
        $collections = new FailingDeleteCollections($this->app->build(ProjectCollections::class));
        $collections->failAfter = 1;
        $this->app->instance(ProjectCollections::class, $collections);

        $this->asUser('alice')->deleteJson('/api/v1/admin/projects/'.$created['id'])->assertStatus(500);
        $this->assertSame(1, $collections->deleted, 'The first collection went before the failure.');
        $this->assertNotNull(Project::query()->find($created['id']));
        $this->assertSame(4, ProjectResource::query()->where('project_id', $created['id'])->count(), 'Three collections and the folder are left.');

        $collections->failAfter = null;
        $this->asUser('alice')->deleteJson('/api/v1/admin/projects/'.$created['id'])->assertOk();
        $this->assertNull(Project::query()->find($created['id']));
        $this->assertSame(0, ProjectResource::query()->where('project_id', $created['id'])->count());
    }

    public function test_an_organization_admin_lists_the_archived_projects_of_every_team(): void
    {
        $launch = $this->createProject('bob', 't1', 'Launch');
        $this->createProject('bob', 't1', 'Live');
        $this->archive('bob', $launch['id'])->assertOk();

        $list = $this->asUser('alice')->getJson('/api/v1/admin/projects')->assertOk()->json('list');
        $this->assertSame([$launch['id']], array_column($list, 'id'));
        $this->assertSame('t1', $list[0]['teamSlug']);
        $this->assertSame('Launch', $list[0]['name']);
        $this->asUser('bob')->getJson('/api/v1/admin/projects')->assertForbidden();
    }

    private function joinTeam(string $username, string $team): void
    {
        $group = Principal::query()->where('uri', 'principals/groups/'.$team)->firstOrFail();
        $this->addPrincipalToGroup($group, Principal::forUsername($username));
    }

    private function archive(string $username, string $id): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/projects/'.$id.'/archive');
    }

    /** @param list<array{0: string, 1: array<string, mixed>, 2: string}> $calls */
    private function jmap(string $username, string $capability, array $calls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $calls,
        ])->assertOk();
    }

    private function files(): Filesystem
    {
        return app(WgwStorage::class)->files();
    }
}

/** Purge stand-in: fails on the delete after `$failAfter` deletes went through. */
final class FailingDeleteCollections extends ProjectCollections
{
    public ?int $failAfter = null;

    public int $deleted = 0;

    public function __construct(private readonly ProjectCollections $real) {}

    public function delete(string $groupPrincipalUri, int $calendarId): void
    {
        if ($this->failAfter !== null && $this->deleted >= $this->failAfter) {
            throw new \RuntimeException('Simulated failure deleting a Project collection.');
        }
        $this->real->delete($groupPrincipalUri, $calendarId);
        $this->deleted++;
    }
}
