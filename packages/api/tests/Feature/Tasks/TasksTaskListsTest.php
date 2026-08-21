<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class TasksTaskListsTest extends WgwDatabaseTestCase
{
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
    }

    public function test_list_task_lists_returns_vtodo_capable_calendars(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists');

        $response->assertOk()
            ->assertJsonCount(3, 'list')
            ->assertJsonPath('list.0.id', InboxTaskListProvisioner::URI)
            ->assertJsonPath('list.0.name', InboxTaskListProvisioner::DISPLAY_NAME)
            ->assertJsonPath('list.0.isDefault', true)
            ->assertJsonPath('list.0.scope', 'personal')
            ->assertJsonPath('list.0.groupSlug', null)
            ->assertJsonPath('list.0.myRights.mayReadItems', true);
    }

    public function test_list_task_lists_excludes_mixed_calendar(): void
    {
        $caldav = new PDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/bob', 'legacy-mixed', [
            '{DAV:}displayname' => 'Calendar',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VTODO', 'VJOURNAL']),
        ]);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists');

        $response->assertOk();
        $ids = collect($response->json('list'))->pluck('id')->all();
        $this->assertContains(InboxTaskListProvisioner::URI, $ids);
        $this->assertNotContains('legacy-mixed', $ids);
    }

    public function test_list_task_lists_excludes_vevent_only_calendar(): void
    {
        $caldav = new PDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/bob', 'events-only', [
            '{DAV:}displayname' => 'Events',
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ]);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists');

        $response->assertOk();
        $ids = collect($response->json('list'))->pluck('id')->all();
        $this->assertContains(InboxTaskListProvisioner::URI, $ids);
        $this->assertNotContains('events-only', $ids);
    }

    public function test_list_task_lists_provisions_inbox_when_missing(): void
    {
        $this->seedWgwUser('legacy-only', displayName: 'Legacy Only');
        $token = $this->issueBearerTokenFor('legacy-only');

        $this->assertFalse(
            app(InboxTaskListProvisioner::class)->hasInboxCalendar('principals/legacy-only'),
        );

        $response = $this->withBearer($token)->getJson('/api/v1/tasks/tasklists');

        $response->assertOk();
        $ids = collect($response->json('list'))->pluck('id')->all();
        $this->assertContains(InboxTaskListProvisioner::URI, $ids);
        $this->assertContains('tasks-home', $ids);
        $this->assertContains('tasks-work', $ids);
        $this->assertTrue(
            app(InboxTaskListProvisioner::class)->hasInboxCalendar('principals/legacy-only'),
        );
    }

    public function test_show_task_list(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/'.InboxTaskListProvisioner::URI);

        $response->assertOk()
            ->assertJsonPath('id', InboxTaskListProvisioner::URI)
            ->assertJsonPath('id', 'tasks-inbox')
            ->assertJsonPath('role', 'inbox')
            ->assertJsonPath('scope', 'personal')
            ->assertJsonPath('groupSlug', null)
            ->assertJsonPath('shareWith', null);
    }

    public function test_show_missing_task_list_returns_not_found(): void
    {
        $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/tasks/tasklists/missing')
            ->assertNotFound();
    }
}
