<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Dav\Server\AppSharedCalendar;
use App\Dav\Server\ProjectCollectionPropPatchPlugin;
use App\Dav\Server\WgwCalendarBackendFactory;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Sabre\DAV\Server;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\DAV\SimpleCollection;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #817 B1: a Project collection follows its Project. Delete, owner transfer and an
 * owner-side name or color change are 403 `project_item` over REST, JMAP and DAV;
 * other properties stay writable; responses say so with `projectId` and the rights.
 */
final class ProjectCollectionGuardsTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_rest_refuses_delete_rename_recolor_and_transfer_even_for_the_team_admin(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch', '#22c55e');
        $ids = $project['resources'];

        foreach ([
            ['tasks/tasklists/'.$ids['taskListId'], ['name' => 'Mine']],
            ['tasks/tasklists/'.$ids['taskListId'], ['color' => '#000000']],
            ['tasks/tasklists/'.$ids['taskListId'], ['groupSlug' => null]],
            ['notes/notebooks/'.$ids['notebookId'], ['name' => 'Mine']],
            ['chat/channels/'.$ids['channelId'], ['name' => 'Mine']],
        ] as [$path, $patch]) {
            $this->asUser('bob')->patchJson('/api/v1/'.$path, $patch)
                ->assertForbidden()
                ->assertJsonPath('code', 'project_item');
        }
        foreach (['tasks/tasklists/'.$ids['taskListId'], 'notes/notebooks/'.$ids['notebookId'], 'chat/channels/'.$ids['channelId']] as $path) {
            $this->asUser('bob')->deleteJson('/api/v1/'.$path)->assertForbidden()->assertJsonPath('code', 'project_item');
        }

        // The current value sent back is no change; other properties stay writable.
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$ids['taskListId'], ['name' => 'Launch', 'color' => '#22C55E', 'description' => 'Plan'])
            ->assertOk()
            ->assertJsonPath('description', 'Plan');
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$ids['channelId'], ['topic' => 'Kick-off'])->assertOk();
        $this->assertSame('Launch', $this->asUser('dave')->getJson('/api/v1/tasks/tasklists/'.$ids['taskListId'])->assertOk()->json('name'));
    }

    public function test_responses_carry_the_project_and_the_rights(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $ids = $project['resources'];
        $loose = $this->asUser('bob')->postJson('/api/v1/tasks/tasklists', ['name' => 'Loose', 'groupSlug' => 't1'])->assertCreated()->json();

        $lists = collect($this->asUser('bob')->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list'))->keyBy('id');
        $this->assertSame($project['id'], $lists[$ids['taskListId']]['projectId']);
        $this->assertFalse($lists[$ids['taskListId']]['myRights']['mayDelete']);
        $this->assertFalse($lists[$ids['taskListId']]['myRights']['mayRename']);
        $this->assertNull($lists[$loose['id']]['projectId']);
        $this->assertTrue($lists[$loose['id']]['myRights']['mayDelete']);
        $this->assertTrue($lists[$loose['id']]['myRights']['mayRename']);

        $notebook = $this->asUser('dave')->getJson('/api/v1/notes/notebooks/'.$ids['notebookId'])->assertOk();
        $notebook->assertJsonPath('projectId', $project['id'])->assertJsonPath('myRights.mayRename', false);
        $channel = $this->asUser('dave')->getJson('/api/v1/chat/channels/'.$ids['channelId'])->assertOk();
        $channel->assertJsonPath('projectId', $project['id'])->assertJsonPath('myRights.mayDelete', false);

        $calendars = collect($this->jmap('bob', JmapCapabilities::CALENDARS, [['Calendar/get', ['accountId' => 'bob'], 'g']])
            ->json('methodResponses.0.1.list'))->keyBy('id');
        $this->assertSame($project['id'], $calendars[$ids['calendarId']]['projectId']);
        $this->assertFalse($calendars[$ids['calendarId']]['myRights']['mayDelete']);

        // A collection in no Project behaves as before.
        $this->asUser('bob')->patchJson('/api/v1/tasks/tasklists/'.$loose['id'], ['name' => 'Loose 2'])->assertOk();
        $this->asUser('bob')->deleteJson('/api/v1/tasks/tasklists/'.$loose['id'])->assertOk();
    }

    public function test_jmap_calendar_and_notebook_set_are_refused(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $ids = $project['resources'];

        $calendar = $this->jmap('bob', JmapCapabilities::CALENDARS, [
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$ids['calendarId'] => ['name' => 'Mine']]], 'u'],
            ['Calendar/set', ['accountId' => 'bob', 'destroy' => [$ids['calendarId']], 'onDestroyRemoveEvents' => true], 'd'],
            ['Calendar/set', ['accountId' => 'bob', 'update' => [$ids['calendarId'] => ['description' => 'Launch dates']]], 'ok'],
        ]);
        $this->assertSame('forbidden', $calendar->json('methodResponses.0.1.notUpdated.'.$ids['calendarId'].'.type'));
        $this->assertSame('forbidden', $calendar->json('methodResponses.1.1.notDestroyed.'.$ids['calendarId'].'.type'));
        $this->assertArrayHasKey($ids['calendarId'], $calendar->json('methodResponses.2.1.updated') ?? []);

        $notebook = $this->jmap('bob', JmapCapabilities::NOTES, [
            ['Notebook/set', ['accountId' => 'bob', 'update' => [$ids['notebookId'] => ['color' => '#000000']]], 'u'],
            ['Notebook/set', ['accountId' => 'bob', 'destroy' => [$ids['notebookId']]], 'd'],
        ]);
        $this->assertSame('forbidden', $notebook->json('methodResponses.0.1.notUpdated.'.$ids['notebookId'].'.type'));
        $this->assertSame('forbidden', $notebook->json('methodResponses.1.1.notDestroyed.'.$ids['notebookId'].'.type'));
    }

    public function test_patch_project_still_writes_through(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');

        $this->asUser('bob')->patchJson('/api/v1/projects/'.$project['id'], ['name' => 'Big launch', 'color' => '#3b82f6'])->assertOk();

        $list = $this->asUser('dave')->getJson('/api/v1/tasks/tasklists/'.$project['resources']['taskListId'])->assertOk();
        $list->assertJsonPath('name', 'Big launch');
        $this->assertSame('#3b82f6', CalendarColorPalette::normalize($list->json('color')));
        $this->asUser('dave')->getJson('/api/v1/chat/channels/'.$project['resources']['channelId'])->assertJsonPath('name', 'Big launch');
    }

    public function test_dav_proppatch_refuses_the_owner_name_and_color_but_not_other_properties_or_a_sharee(): void
    {
        $this->createProject('bob', 't1', 'Launch');
        $backend = app(WgwCalendarBackendFactory::class)->calBackend();
        $info = collect($backend->getCalendarsForUser('principals/groups/t1'))->firstWhere('uri', 'prj-launch');
        $this->assertIsArray($info);

        $owner = $this->davServer(new AppSharedCalendar($backend, $info));
        $refused = $owner->updateProperties('calendars/prj-launch', [
            '{DAV:}displayname' => 'Mine',
            CalendarColorPalette::PROPERTY => '#000000',
        ]);
        $this->assertSame(403, $refused['{DAV:}displayname']);
        $this->assertSame(403, $refused[CalendarColorPalette::PROPERTY]);

        $description = '{urn:ietf:params:xml:ns:caldav}calendar-description';
        $this->assertSame(200, $owner->updateProperties('calendars/prj-launch', [$description => 'Launch dates'])[$description]);

        $sharee = $this->davServer(new AppSharedCalendar($backend, [...$info, 'share-access' => SharingPlugin::ACCESS_READWRITE]));
        $this->assertSame(200, $sharee->updateProperties('calendars/prj-launch', ['{DAV:}displayname' => 'My launch'])['{DAV:}displayname']);
    }

    private function davServer(AppSharedCalendar $calendar): Server
    {
        $server = new Server(new SimpleCollection('root', [new SimpleCollection('calendars', [$calendar])]));
        $server->addPlugin(app(ProjectCollectionPropPatchPlugin::class));

        return $server;
    }

    /** @param list<array{0: string, 1: array<string, mixed>, 2: string}> $calls */
    private function jmap(string $username, string $capability, array $calls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $calls,
        ])->assertOk();
    }
}
