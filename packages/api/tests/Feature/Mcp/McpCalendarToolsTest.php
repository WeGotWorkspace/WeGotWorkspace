<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\CalendarEventsTool;
use App\Mcp\Tools\CalendarEventWriteTool;
use App\Mcp\Tools\CalendarShareTool;
use App\Mcp\Tools\CalendarWriteTool;
use App\Services\Calendars\CalendarRepository;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Mcp\McpScopes;
use Laravel\Passport\Passport;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class McpCalendarToolsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use ConfiguresMcp;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->enableMcp();
        config(['app.url' => 'https://workspace.test']);
    }

    public function test_calendar_events_accepts_read_scope_and_denies_write(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CALENDAR_READ], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(CalendarEventsTool::class, ['calendarId' => 'default'])
            ->assertOk();

        WorkspaceServer::actingAs($user, 'api')
            ->tool(CalendarEventWriteTool::class, [
                'action' => 'create',
                'calendarId' => 'default',
                'title' => 'Blocked',
                'start' => '2030-01-15T10:00:00Z',
            ])
            ->assertHasErrors(['Missing OAuth scope: calendar.write']);
    }

    public function test_legacy_calendar_scope_can_query_and_write_events(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CALENDAR], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(CalendarEventsTool::class, ['calendarId' => 'default'])
            ->assertOk();

        WorkspaceServer::actingAs($user, 'api')
            ->tool(CalendarEventWriteTool::class, [
                'action' => 'create',
                'calendarId' => 'default',
                'title' => 'Legacy write',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
            ])
            ->assertOk()
            ->assertSee('Legacy write');
    }

    public function test_calendar_event_write_creates_weekly_event_with_notes_meet_and_participants(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CALENDAR_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(CalendarEventWriteTool::class, [
                'action' => 'create',
                'calendarId' => 'default',
                'title' => 'Weekly standup',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'description' => 'Bring notes',
                'recurrenceRules' => [['@type' => 'RecurrenceRule', 'frequency' => 'weekly']],
                'participants' => [
                    'carol' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
                'meet' => 'new',
            ])
            ->assertOk()
            ->assertSee('Weekly standup')
            ->assertSee('Bring notes')
            ->assertSee('/meet/meetings/');
    }

    public function test_calendar_event_write_attaches_existing_channel_meet_link(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        $channel = app(ChatChannelRepository::class)->create('bob', [
            'name' => 'Team',
            'kind' => 'channel',
        ]);
        Passport::actingAs($user, [McpScopes::CALENDAR_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(CalendarEventWriteTool::class, [
                'action' => 'create',
                'calendarId' => 'default',
                'title' => 'Channel call',
                'start' => '2030-02-01T10:00:00Z',
                'end' => '2030-02-01T10:30:00Z',
                'meetChannelId' => $channel['id'],
            ])
            ->assertOk()
            ->assertSee('/meet/channels/'.$channel['id']);
    }

    public function test_calendar_event_write_enforces_acl(): void
    {
        $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        $calendar = app(CalendarRepository::class)->create('bob', [
            'name' => 'Secret',
            'id' => 'bob-secret',
        ]);
        Passport::actingAs($carol, [McpScopes::CALENDAR_WRITE], 'api', $client);

        WorkspaceServer::actingAs($carol, 'api')
            ->tool(CalendarEventWriteTool::class, [
                'action' => 'create',
                'calendarId' => (string) $calendar['id'],
                'title' => 'Nope',
                'start' => '2030-01-15T10:00:00Z',
            ])
            ->assertHasErrors(['Calendar not found']);
    }

    public function test_calendar_write_and_share_round_trip(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::CALENDAR_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(CalendarWriteTool::class, [
                'action' => 'create',
                'name' => 'Projects',
            ])
            ->assertOk()
            ->assertSee('Projects');

        $calendarId = $this->calendarIdNamed('bob', 'Projects');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(CalendarShareTool::class, [
                'action' => 'set',
                'calendarId' => $calendarId,
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ])
            ->assertOk()
            ->assertSee('alice');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(CalendarShareTool::class, [
                'action' => 'get',
                'calendarId' => $calendarId,
            ])
            ->assertOk()
            ->assertSee('alice');
    }

    public function test_calendar_share_denies_non_owner(): void
    {
        $bob = $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::CALENDAR_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(CalendarWriteTool::class, ['action' => 'create', 'name' => 'Private'])
            ->assertOk();
        $calendarId = $this->calendarIdNamed('bob', 'Private');

        Passport::actingAs($carol, [McpScopes::CALENDAR_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(CalendarShareTool::class, [
                'action' => 'set',
                'calendarId' => $calendarId,
                'shareWith' => ['bob' => ['mayReadItems' => true]],
            ])
            ->assertHasErrors(['Calendar not found']);
    }

    private function calendarIdNamed(string $username, string $name): string
    {
        $row = collect(app(CalendarRepository::class)->list($username)['list'])
            ->first(static fn (array $calendar): bool => ($calendar['name'] ?? '') === $name);
        $this->assertIsArray($row);
        $this->assertNotSame('', (string) ($row['id'] ?? ''));

        return (string) $row['id'];
    }
}
