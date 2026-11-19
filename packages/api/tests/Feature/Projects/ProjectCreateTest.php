<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Calendars\CalDavCollections;
use App\Services\Calendars\CollectionKind;
use App\Services\Projects\ProjectKind;
use App\Services\Projects\ProjectMarkers;
use Illuminate\Support\Facades\DB;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #817: create, rename and recolor, and the ensure that repairs a Project on read.
 */
final class ProjectCreateTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_create_makes_four_team_collections_and_registers_them(): void
    {
        $markerBefore = $this->markerOf('t1');
        $project = $this->createProject('bob', 't1', 'Spring launch', '#22C55E');

        $this->assertSame('t1', $project['teamSlug']);
        $this->assertSame('spring-launch', $project['slug']);
        $this->assertSame('#22c55e', $project['color']);
        $this->assertFalse($project['isDefault']);
        $this->assertFalse($project['archived']);
        $this->assertTrue($project['mayManage']);
        $this->assertNull($project['resources']['driveFolderId']);

        $expected = [
            ProjectKind::Calendar->value => [CollectionKind::EventCalendar, 'calendarId'],
            ProjectKind::TaskList->value => [CollectionKind::TaskList, 'taskListId'],
            ProjectKind::Notebook->value => [CollectionKind::Notebook, 'notebookId'],
            ProjectKind::Channel->value => [CollectionKind::ChatChannel, 'channelId'],
        ];
        $resources = ProjectResource::query()->where('project_id', $project['id'])->get()->keyBy('kind');
        $this->assertSame(array_keys($expected), array_values(array_intersect(array_keys($expected), $resources->keys()->all())));
        foreach ($expected as $kind => [$collectionKind, $responseKey]) {
            $instance = CalendarInstance::query()
                ->where('calendarid', (int) $resources[$kind]->locator)
                ->where('principaluri', 'principals/groups/t1')
                ->first();
            $this->assertNotNull($instance, $kind.' is owned by the Team');
            $this->assertSame('Spring launch', $instance->displayname);
            $this->assertSame($instance->uri, $project['resources'][$responseKey]);
            $this->assertSame(
                $collectionKind->value,
                (string) DB::connection('wgw')->table('calendar_collection_meta')->where('calendarid', $instance->calendarid)->value('kind'),
            );
            if ($kind !== ProjectKind::Channel->value) {
                $this->assertSame('#22c55e', strtolower(substr((string) $instance->calendarcolor, 0, 7)));
            }
        }
        $channelMeta = ChatChannelMeta::query()->find((int) $resources[ProjectKind::Channel->value]->locator);
        $this->assertNotNull($channelMeta);
        $this->assertSame(ChatChannelMeta::KIND_CHANNEL, $channelMeta->kind);
        $this->assertNull($channelMeta->default_for_group);

        $this->assertSame($markerBefore + 1, $this->markerOf('t1'));
    }

    public function test_a_slug_clash_in_the_team_gets_a_suffix_and_archived_projects_keep_theirs(): void
    {
        $this->assertSame('launch', $this->createProject('bob', 't1', 'Launch')['slug']);
        $second = $this->createProject('bob', 't1', 'Launch');
        $this->assertSame('launch-2', $second['slug']);

        Project::query()->whereKey($second['id'])->update(['archived_at' => now()]);
        $this->assertSame('launch-3', $this->createProject('bob', 't1', 'Launch')['slug']);

        // Another Team has its own slugs.
        $this->assertSame('launch', $this->createProject('carol', 't2', 'Launch')['slug']);
        // A name without slug characters still gets one.
        $this->assertSame('project', $this->createProject('bob', 't1', '🚀')['slug']);
    }

    public function test_name_and_color_are_validated(): void
    {
        foreach ([
            ['teamSlug' => 't1', 'name' => '  '],
            ['teamSlug' => 't1', 'name' => str_repeat('a', 101)],
            ['teamSlug' => 't1', 'name' => 'Ok', 'color' => 'blue'],
            ['teamSlug' => 't1', 'name' => 'Ok', 'color' => '#12345'],
        ] as $payload) {
            $this->asUser('bob')->postJson('/api/v1/projects', $payload)
                ->assertStatus(400)
                ->assertJsonPath('code', 'invalidProperties');
        }
        $this->assertSame(0, Project::query()->count());
    }

    public function test_patch_writes_name_and_color_through_and_keeps_ids(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch', '#22c55e');
        $markerBefore = $this->markerOf('t1');

        $patched = $this->asUser('bob')->patchJson('/api/v1/projects/'.$project['id'], ['name' => 'Big launch', 'color' => '#3b82f6'])
            ->assertOk()
            ->json();

        $this->assertSame('Big launch', $patched['name']);
        $this->assertSame('#3b82f6', $patched['color']);
        $this->assertSame('launch', $patched['slug']);
        $this->assertSame($project['resources'], $patched['resources']);
        foreach (ProjectResource::query()->where('project_id', $project['id'])->get() as $resource) {
            $instance = CalendarInstance::query()->where('calendarid', (int) $resource->locator)->firstOrFail();
            $this->assertSame('Big launch', $instance->displayname, $resource->kind);
            if ($resource->kind !== ProjectKind::Channel->value) {
                $this->assertSame('#3b82f6', strtolower(substr((string) $instance->calendarcolor, 0, 7)), $resource->kind);
            }
        }
        $this->assertSame($markerBefore + 1, $this->markerOf('t1'));

        $this->asUser('bob')->patchJson('/api/v1/projects/'.$project['id'], [])->assertStatus(400);

        Project::query()->whereKey($project['id'])->update(['archived_at' => now()]);
        $this->asUser('bob')->patchJson('/api/v1/projects/'.$project['id'], ['name' => 'Again'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'archived');
    }

    public function test_ensure_recreates_a_missing_collection_once_and_skips_archived_projects(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $notebook = ProjectResource::query()->where('project_id', $project['id'])->where('kind', ProjectKind::Notebook->value)->firstOrFail();
        $this->deleteCollection((int) $notebook->locator);

        $first = collect($this->listProjects('dave')->assertOk()->json('list'))->firstWhere('id', $project['id'])['resources'];
        $second = collect($this->listProjects('bob')->assertOk()->json('list'))->firstWhere('id', $project['id'])['resources'];

        $this->assertNotNull($first['notebookId']);
        $this->assertNotSame(
            $notebook->locator,
            ProjectResource::query()->where('project_id', $project['id'])->where('kind', ProjectKind::Notebook->value)->value('locator'),
            'The registry points at the new notebook.',
        );
        $this->assertSame($first, $second, 'The second read finds nothing to repair.');
        $this->assertSame($project['resources']['calendarId'], $first['calendarId']);
        $this->assertSame(
            1,
            CalendarInstance::query()->where('principaluri', 'principals/groups/t1')->where('uri', 'like', 'prj-launch-notes%')->count(),
        );

        $archived = $this->createProject('bob', 't1', 'Old');
        Project::query()->whereKey($archived['id'])->update(['archived_at' => now()]);
        $calendar = ProjectResource::query()->where('project_id', $archived['id'])->where('kind', ProjectKind::Calendar->value)->firstOrFail();
        $this->deleteCollection((int) $calendar->locator);

        $listed = collect($this->listProjects('bob', archived: true)->json('list'))->firstWhere('id', $archived['id']);
        $this->assertIsArray($listed);
        $this->assertTrue($listed['archived']);
        $this->assertNull($listed['resources']['calendarId'], 'An archived Project is not repaired.');
    }

    private function markerOf(string $team): int
    {
        return app(ProjectMarkers::class)->markersFor([$team])[$team];
    }

    private function deleteCollection(int $calendarId): void
    {
        $instance = CalendarInstance::query()->where('calendarid', $calendarId)->firstOrFail();
        app(WgwCalendarBackendFactory::class)->calBackend()->deleteCalendar(app(CalDavCollections::class)->backendId($instance));
    }
}
