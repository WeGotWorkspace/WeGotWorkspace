<?php

declare(strict_types=1);

namespace Tests\Feature\JmapRest;

use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class JmapRestCrossUserAclTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setUpTasksFixtures();
        $this->seedDefaultCalendarFor('bob');
        $this->seedDefaultCalendarFor('carol');
        $this->seedDefaultTaskListFor('bob');
        $this->seedDefaultTaskListFor('carol');
    }

    public function test_guest_cannot_access_jmap_rest_resources(): void
    {
        $this->getJson('/api/v1/calendars/events/demo-event')->assertUnauthorized();
        $this->getJson('/api/v1/tasks/items/demo-task')->assertUnauthorized();
    }

    public function test_user_cannot_read_other_users_calendar_event(): void
    {
        $eventId = $this->seedEventViaPdo('carol', 'carol-event.ics', $this->sampleIcs('Carol Event'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/'.$eventId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_update_other_users_calendar_event(): void
    {
        $eventId = $this->seedEventViaPdo('carol', 'carol-event-update.ics', $this->sampleIcs('Carol Event Update'));

        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/calendars/events/'.$eventId, $this->sampleCalendarEventPayload())
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/calendars/events/'.$eventId, ['title' => 'Hijacked'])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_delete_other_users_calendar_event(): void
    {
        $eventId = $this->seedEventViaPdo('carol', 'carol-event-delete.ics', $this->sampleIcs('Carol Event Delete'));

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/calendars/events/'.$eventId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_list_other_users_calendar_events(): void
    {
        $this->seedEventViaPdo('carol', 'carol-list-event.ics', $this->sampleIcs('Carol List Event'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events?calendarId=default')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    public function test_user_cannot_sync_or_query_other_users_private_calendar(): void
    {
        $this->seedPrivateCalendarFor('carol', 'carol-private-cal');

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/calendars/events/changes?calendarId=carol-private-cal')
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/query', [
                'filter' => ['inCalendars' => ['carol-private-cal']],
            ])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_mutate_other_users_calendar_event_via_set(): void
    {
        $eventId = $this->seedEventViaPdo('carol', 'carol-set-target.ics', $this->sampleIcs('Carol Set Target'));

        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/calendars/events/set', [
                'update' => [$eventId => ['title' => 'Hijacked']],
                'destroy' => [$eventId],
            ])
            ->assertOk()
            ->assertJsonPath('notUpdated.'.$eventId.'.type', 'notFound')
            ->assertJsonPath('notDestroyed.'.$eventId.'.type', 'notFound')
            ->assertJsonPath('updated', [])
            ->assertJsonPath('destroyed', []);
    }

    public function test_user_cannot_read_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task-read.ics', $this->sampleTodoIcs('Carol Task'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items/'.$taskId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_update_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task-update.ics', $this->sampleTodoIcs('Carol Task Update'));

        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/tasks/items/'.$taskId, $this->sampleTaskCreatePayload())
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/tasks/items/'.$taskId, ['title' => 'Hijacked'])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_delete_other_users_task(): void
    {
        $taskId = $this->seedTaskViaPdo('carol', 'carol-task-delete.ics', $this->sampleTodoIcs('Carol Task Delete'));

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/tasks/items/'.$taskId)
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_user_cannot_list_other_users_tasks(): void
    {
        $this->seedTaskViaPdo('carol', 'carol-list-task.ics', $this->sampleTodoIcs('Carol List Task'));

        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/items?taskListId='.InboxTaskListProvisioner::URI)
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    private function seedPrivateCalendarFor(string $username, string $calendarUri): void
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/'.$username, $calendarUri, [
            '{DAV:}displayname' => 'Private',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ]);
    }
}
