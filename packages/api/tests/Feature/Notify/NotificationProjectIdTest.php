<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Models\Project;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Projects\DefaultProjectProvisioner;
use App\Storage\WgwStorage;
use App\Support\WgwSettings;
use Tests\Feature\Projects\ProjectsWorld;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #810: an inbox row carries the Project of its subject (`projectId`), so the apps can follow
 * the Project filter. A subject in no Project stores null.
 *
 * bob is team admin of T1 and dave a plain member of it (see ProjectsWorld).
 */
final class NotificationProjectIdTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use ProjectsWorld;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        $this->seedDefaultCalendarFor('bob');
        $this->seedDefaultCalendarFor('dave');
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_a_chat_mention_in_a_project_channel_stores_the_project(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');

        $this->asUser('bob')->postJson('/api/v1/chat/channels/'.$project['resources']['channelId'].'/messages', [
            'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAA',
            'body' => 'hey @dave',
            'mentions' => [['id' => 'dave']],
        ])->assertCreated();

        $row = Notification::query()->where('principal', 'dave')->where('action', 'mentioned')->firstOrFail();
        $this->assertSame($project['id'], $row->project_id);
        $this->assertArrayNotHasKey('projectId', $row->data ?? []);

        $listed = $this->asUser('dave')->getJson('/api/v1/notifications')->assertOk()->json('list');
        $this->assertSame($project['id'], $listed[0]['projectId']);
    }

    public function test_a_direct_message_mention_stores_null(): void
    {
        $channel = $this->asUser('bob')->postJson('/api/v1/chat/channels', ['name' => 'Side', 'kind' => 'channel'])
            ->assertCreated()->json('id');
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$channel, [
            'shareWith' => ['dave' => ['mayWriteAll' => true]],
        ])->assertOk();

        $this->asUser('bob')->postJson('/api/v1/chat/channels/'.$channel.'/messages', [
            'id' => '01J6Y6M0R2V9GKJ4W1T8Q3ZBAB',
            'body' => 'hey @dave',
            'mentions' => [['id' => 'dave']],
        ])->assertCreated();

        $row = Notification::query()->where('principal', 'dave')->where('action', 'mentioned')->firstOrFail();
        $this->assertNull($row->project_id);
        $listed = $this->asUser('dave')->getJson('/api/v1/notifications')->assertOk()->json('list');
        $this->assertArrayHasKey('projectId', $listed[0]);
        $this->assertNull($listed[0]['projectId']);
    }

    public function test_a_task_assigned_in_a_project_task_list_stores_the_project(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $listId = (string) $project['resources']['taskListId'];

        $taskId = (string) $this->asUser('bob')->postJson('/api/v1/tasks/items', [
            'taskListIds' => [$listId => true],
            'title' => 'Write plan',
            'due' => '2026-06-15T09:00:00',
        ])->assertCreated()->json('id');
        $url = '/api/v1/tasks/items/'.$taskId;
        $etag = (string) $this->asUser('bob')->getJson($url)->assertOk()->json('etag');
        $this->asUser('bob')->patchJson($url, [
            'participants' => ['u:dave' => ['@type' => 'Participant', 'roles' => ['attendee']]],
        ], ['If-Match' => $etag])->assertOk();

        $row = Notification::query()->where('principal', 'dave')->where('action', 'assigned')->firstOrFail();
        $this->assertSame($project['id'], $row->project_id);
    }

    public function test_a_calendar_invite_stores_the_project_of_a_project_calendar_and_null_for_a_personal_one(): void
    {
        $project = $this->createProject('bob', 't1', 'Launch');
        $this->invite((string) $project['resources']['calendarId'], 'Kickoff');
        $this->invite('default', 'Lunch');

        $kickoff = Notification::query()->where('principal', 'dave')->where('action', 'invite')->where('title', 'like', '%Kickoff')->firstOrFail();
        $lunch = Notification::query()->where('principal', 'dave')->where('action', 'invite')->where('title', 'like', '%Lunch')->firstOrFail();
        $this->assertSame($project['id'], $kickoff->project_id);
        $this->assertNull($lunch->project_id);
    }

    public function test_a_docs_share_inside_a_project_folder_stores_the_project(): void
    {
        app(DefaultProjectProvisioner::class)->ensureForTeams(['t1']);
        $project = $this->createProject('bob', 't1', 'Launch');
        $files = app(WgwStorage::class)->files();
        $files->put('groups/t1/Launch/plan.md', '# Plan');
        $files->put('groups/t1/loose.md', '# Loose');
        $files->put('users/bob/own.md', '# Own');
        foreach (['groups/t1/Launch/plan.md', 'groups/t1/loose.md', 'users/bob/own.md'] as $key) {
            app(FileNodeIndexService::class)->recordCreate($key);
            $this->asUser('bob')->postJson('/api/v1/files/shares', [
                'path' => '/'.$key,
                'kind' => 'member',
                'defaultAccess' => 'view',
                'shareWith' => ['dave' => ['access' => 'view']],
            ])->assertOk();
        }

        $byFile = Notification::query()->where('principal', 'dave')->where('action', 'shared')->get()
            ->mapWithKeys(fn (Notification $row): array => [(string) ($row->data['fileName'] ?? '') => $row->project_id]);
        $this->assertSame($project['id'], $byFile['plan.md']);
        // The Team's default Project owns the rest of the Team Drive; a personal file is in none.
        $this->assertSame(Project::query()->where('default_for_group', 't1')->value('id'), $byFile['loose.md']);
        $this->assertNull($byFile['own.md']);
    }

    private function invite(string $calendarId, string $title): void
    {
        $this->asUser('bob')->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => [
                ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['inv' => [
                    'calendarIds' => [$calendarId => true],
                    'title' => $title,
                    'start' => '2030-01-15T10:00:00Z',
                    'end' => '2030-01-15T10:30:00Z',
                    'participants' => [
                        'org' => ['@type' => 'Participant', 'email' => 'bob@example.test', 'name' => 'Bob', 'roles' => ['owner']],
                        'att1' => ['@type' => 'Participant', 'email' => 'dave@example.org', 'name' => 'Dave', 'roles' => ['attendee'], 'expectReply' => true, 'participationStatus' => 'needs-action'],
                    ],
                ]]], 'c0'],
            ],
        ])->assertOk();
    }
}
