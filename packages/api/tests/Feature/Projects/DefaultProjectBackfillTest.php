<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarInstance;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Admin\AdminGroupManagementService;
use App\Services\Calendars\CalDavCollections;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Projects\DefaultProjectProvisioner;
use App\Services\Projects\ProjectKind;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #817 A2: every Team has one default Project, "{Team name} Project", made of its
 * provisioned calendar, task list and notebook plus one new channel.
 */
final class DefaultProjectBackfillTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_team_create_ends_with_the_default_project(): void
    {
        app(AdminGroupManagementService::class)->create('studio', 'Studio');

        $project = Project::query()->where('default_for_group', 'studio')->firstOrFail();
        $this->assertSame('Studio Project', $project->name);
        $this->assertSame('studio-project', $project->slug);

        $byKind = $this->registeredInstances($project);
        $this->assertSame('studio', $byKind[ProjectKind::Calendar->value]->uri);
        $this->assertSame('tasks-studio', $byKind[ProjectKind::TaskList->value]->uri);
        $this->assertSame('notes-studio', $byKind[ProjectKind::Notebook->value]->uri);
        $this->assertStringStartsWith('chat-studio-project-', (string) $byKind[ProjectKind::Channel->value]->uri);
        // Existing names stay; the new channel takes the Project's name; the Project the calendar's color.
        $this->assertSame('Studio', $byKind[ProjectKind::Calendar->value]->displayname);
        $this->assertSame('Studio', $byKind[ProjectKind::Notebook->value]->displayname);
        $this->assertSame('Studio Project', $byKind[ProjectKind::Channel->value]->displayname);
        $this->assertSame(strtolower(substr((string) $byKind[ProjectKind::Calendar->value]->calendarcolor, 0, 7)), $project->color);
    }

    public function test_backfill_gives_every_existing_team_one_and_can_run_twice(): void
    {
        $this->assertSame(0, Project::query()->count(), 'The world seeds Teams without going through Team create.');

        $migration = require database_path('migrations/wgw/2026_11_19_000971_wgw_backfill_default_projects.php');
        $migration->up();
        $migration->up();
        app(DefaultProjectProvisioner::class)->ensureForTeams(['t1', 't2']);

        $names = Project::query()->orderBy('group_slug')->pluck('name', 'group_slug')->all();
        $this->assertSame('T1 Project', $names['t1'] ?? null);
        $this->assertSame('T2 Project', $names['t2'] ?? null);
        $this->assertSame(1, Project::query()->where('group_slug', 't1')->count());
        $this->assertSame(4 * count($names), ProjectResource::query()->count(), 'Four items per default Project.');
    }

    public function test_the_list_gives_a_team_without_one_its_default_project_first(): void
    {
        $this->createProject('bob', 't1', 'Launch');

        $list = $this->listProjects('dave')->assertOk()->json('list');

        $this->assertSame(['T1 Project', 'Launch'], array_column($list, 'name'));
        $this->assertTrue($list[0]['isDefault']);
        $this->assertSame('group-t1', $list[0]['resources']['calendarId']);
        $this->assertNull($list[0]['resources']['driveFolderId'], 'The default Project has no Drive folder.');
    }

    public function test_team_collections_stay_writable_after_backfill(): void
    {
        app(DefaultProjectProvisioner::class)->ensureForAllTeams();
        $resources = $this->listProjects('dave')->assertOk()->json('list.0.resources');

        $this->asUser('dave')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [$resources['taskListId'] => true],
            'title' => 'Book the venue',
        ])->assertCreated();
        $this->asUser('dave')->postJson('/api/v1/notes/items', [
            'notebookId' => $resources['notebookId'],
            'title' => 'Venue options',
            'body' => 'Three halls.',
        ])->assertCreated();
        $created = $this->asUser('dave')->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [['CalendarEvent/set', ['accountId' => 'dave', 'create' => ['e' => [
                'calendarIds' => [$resources['calendarId'] => true],
                'title' => 'Venue visit',
                'start' => '2030-03-01T10:00:00Z',
                'end' => '2030-03-01T11:00:00Z',
            ]]], 'c0']],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertArrayHasKey('e', $created['created'] ?? [], json_encode($created) ?: '');
    }

    public function test_a_missing_provisioned_collection_is_made_again_and_relinked(): void
    {
        app(DefaultProjectProvisioner::class)->ensureForAllTeams();
        $project = Project::query()->where('default_for_group', 't1')->firstOrFail();
        $notebook = $this->registeredInstances($project)[ProjectKind::Notebook->value];
        app(WgwCalendarBackendFactory::class)->calBackend()->deleteCalendar(app(CalDavCollections::class)->backendId($notebook));

        $resources = $this->listProjects('dave')->assertOk()->json('list.0.resources');

        $this->assertSame('group-t1', $resources['notebookId'], 'The provisioned notebook, made again, not a new prj- one.');
        $relinked = $this->registeredInstances($project)[ProjectKind::Notebook->value];
        $this->assertSame('notes-t1', $relinked->uri);
        $this->assertNotSame((int) $notebook->calendarid, (int) $relinked->calendarid);
    }

    /** @return array<string, CalendarInstance> */
    private function registeredInstances(Project $project): array
    {
        $byKind = [];
        foreach (ProjectResource::query()->where('project_id', $project->id)->get() as $resource) {
            $byKind[(string) $resource->kind] = CalendarInstance::query()
                ->where('calendarid', (int) $resource->locator)
                ->where('principaluri', 'principals/groups/'.$project->group_slug)
                ->firstOrFail();
        }

        return $byKind;
    }
}
