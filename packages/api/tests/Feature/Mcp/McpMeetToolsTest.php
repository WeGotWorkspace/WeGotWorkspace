<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\MeetChannelListTool;
use App\Mcp\Tools\MeetChannelWriteTool;
use App\Mcp\Tools\MeetCreateScheduledTool;
use App\Mcp\Tools\MeetMessageListTool;
use App\Mcp\Tools\MeetMessageWriteTool;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Mcp\McpScopes;
use Laravel\Passport\Passport;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

final class McpMeetToolsTest extends WgwDatabaseTestCase
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

    public function test_channel_and_message_happy_path(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::MEET_READ, McpScopes::MEET_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetChannelWriteTool::class, [
                'action' => 'create',
                'kind' => 'channel',
                'name' => 'MCP General',
                'topic' => 'Ship the tools',
            ])
            ->assertOk()
            ->assertSee('MCP General')
            ->assertSee('channel');

        $channelId = $this->channelIdNamed('bob', 'MCP General');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetChannelListTool::class, ['kind' => 'channel'])
            ->assertOk()
            ->assertSee('MCP General');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetMessageWriteTool::class, [
                'action' => 'create',
                'channelId' => $channelId,
                'body' => 'hello from mcp',
            ])
            ->assertOk()
            ->assertSee('hello from mcp');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetMessageListTool::class, ['channelId' => $channelId])
            ->assertOk()
            ->assertSee('hello from mcp');
    }

    public function test_channel_write_denies_read_scope(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::MEET_READ], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetChannelWriteTool::class, [
                'action' => 'create',
                'kind' => 'channel',
                'name' => 'Blocked',
            ])
            ->assertHasErrors(['Missing OAuth scope: meet.write']);
    }

    public function test_channel_write_enforces_acl(): void
    {
        $bob = $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::MEET_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(MeetChannelWriteTool::class, [
                'action' => 'create',
                'kind' => 'channel',
                'name' => 'Private',
            ])
            ->assertOk();
        $channelId = $this->channelIdNamed('bob', 'Private');

        Passport::actingAs($carol, [McpScopes::MEET_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(MeetMessageWriteTool::class, [
                'action' => 'create',
                'channelId' => $channelId,
                'body' => 'nope',
            ])
            ->assertHasErrors(['Channel not found']);
    }

    public function test_meet_create_scheduled_without_calendar_write_returns_href_only(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::MEET_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetCreateScheduledTool::class, [
                'name' => 'Standup only',
                'calendarId' => 'default',
                'start' => '2030-01-15T10:00:00Z',
            ])
            ->assertOk()
            ->assertSee('Standup only')
            ->assertSee('/meet/meetings/');

        $events = app(CalendarEventRepository::class)->list('bob', 'default', null, null);
        $this->assertSame([], $events['list']);
    }

    public function test_meet_create_scheduled_with_both_scopes_creates_event(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::MEET_WRITE, McpScopes::CALENDAR_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetCreateScheduledTool::class, [
                'name' => 'Scheduled standup',
                'calendarId' => 'default',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'description' => 'Weekly sync',
            ])
            ->assertOk()
            ->assertSee('Scheduled standup')
            ->assertSee('/meet/meetings/')
            ->assertSee('Weekly sync');
    }

    public function test_meet_create_scheduled_denies_without_meet_write(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::CALENDAR_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(MeetCreateScheduledTool::class, [
                'name' => 'No meet scope',
                'calendarId' => 'default',
                'start' => '2030-01-15T10:00:00Z',
            ])
            ->assertHasErrors(['Missing OAuth scope: meet.write']);
    }

    public function test_open_dm_as_channel_family_write(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::MEET_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(MeetChannelWriteTool::class, [
                'action' => 'create',
                'kind' => 'dm',
                'principal' => 'alice',
            ])
            ->assertOk()
            ->assertSee('alice');
    }

    private function channelIdNamed(string $username, string $name): string
    {
        $row = collect(app(ChatChannelRepository::class)->list($username)['list'])
            ->first(static fn (array $channel): bool => ($channel['name'] ?? '') === $name);
        $this->assertIsArray($row);

        return (string) $row['id'];
    }
}
