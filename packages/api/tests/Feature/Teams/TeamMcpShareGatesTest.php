<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\AddressBookShareTool;
use App\Mcp\Tools\CalendarShareTool;
use App\Mcp\Tools\MeetChannelWriteTool;
use App\Mcp\Tools\NotebookShareTool;
use App\Mcp\Tools\TaskListShareTool;
use App\Models\Principal;
use App\Models\User;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Contacts\AddressBookCollectionUris;
use App\Services\Mcp\McpScopes;
use App\Services\Notes\NotebookRepository;
use App\Services\Tasks\TaskListRepository;
use App\Support\WgwSettings;
use Laravel\Passport\Passport;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\ConfiguresMcp;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Chunk D of Epic #1915 over MCP: DM open and every share tool refuse someone outside the
 * caller's Teams with the same error as an unknown name, admins included.
 *
 * Personas: bob and dave share T1; carol is alone in T2; alice is admin and in no Team but
 * the old administrators group.
 */
final class TeamMcpShareGatesTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;
    use ConfiguresMcp;

    private const UNKNOWN_PRINCIPAL = 'Unknown or invalid share principal.';

    /** @var array<string, list<array{0: string, 1: class-string, 2: array<string, mixed>, 3: array<string, bool>}>> */
    private array $shareTools = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->setAppSetting(WgwSettings::CONTACTS_ENABLED, true);
        $this->setAppSetting(WgwSettings::TASKS_ENABLED, true);
        $this->setAppSetting(WgwSettings::NOTES_ENABLED, true);
        $this->enableMcp();
        config(['app.url' => 'https://workspace.test']);
        $this->seedWgwUser('dave', displayName: 'Dave');

        $t1 = $this->seedWgwGroup('principals/groups/t1', 'T1');
        $t2 = $this->seedWgwGroup('principals/groups/t2', 'T2');
        foreach ([[$t1, 'bob'], [$t1, 'dave'], [$t2, 'carol']] as [$team, $username]) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($team, $principal);
        }
        foreach (['alice', 'bob', 'carol', 'dave'] as $username) {
            app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$username);
        }
        $this->seedDefaultCalendarFor('alice');
    }

    public function test_mcp_dm_refuses_a_non_colleague_like_an_unknown_user(): void
    {
        foreach (['bob' => 'carol', 'alice' => 'bob'] as $caller => $refused) {
            foreach ([$refused, 'ghost'] as $target) {
                $this->tool($caller, McpScopes::MEET_WRITE, MeetChannelWriteTool::class, [
                    'action' => 'create', 'kind' => 'dm', 'principal' => $target,
                ])->assertHasErrors(['Unknown or invalid DM principal.']);
            }
        }
        $this->tool('bob', McpScopes::MEET_WRITE, MeetChannelWriteTool::class, [
            'action' => 'create', 'kind' => 'dm', 'principal' => 'dave',
        ])->assertOk();
    }

    public function test_mcp_share_tools_refuse_non_colleagues_like_unknown(): void
    {
        foreach (['bob' => ['carol', 'groups/t2'], 'alice' => ['bob', 'groups/t1']] as $caller => $refusedTargets) {
            $tools = $this->shareTools($caller);
            foreach ($tools as [$scope, $tool, $arguments, $grant]) {
                foreach ([...$refusedTargets, 'ghost', 'groups/nope'] as $target) {
                    $this->tool($caller, $scope, $tool, [...$arguments, 'shareWith' => [$target => $grant]])
                        ->assertHasErrors([self::UNKNOWN_PRINCIPAL]);
                }
            }
        }
        foreach ($this->shareTools('bob') as [$scope, $tool, $arguments, $grant]) {
            $this->tool('bob', $scope, $tool, [...$arguments, 'shareWith' => ['dave' => $grant]])->assertOk();
        }
    }

    /**
     * @return list<array{0: string, 1: class-string, 2: array<string, mixed>, 3: array<string, bool>}>
     */
    private function shareTools(string $owner): array
    {
        if (isset($this->shareTools[$owner])) {
            return $this->shareTools[$owner];
        }
        $list = app(TaskListRepository::class)->create($owner, ['name' => 'Gate '.$owner]);
        $notebook = app(NotebookRepository::class)->create($owner, ['name' => 'Gate '.$owner]);
        $channel = app(ChatChannelRepository::class)->create($owner, ['name' => 'Gate '.$owner, 'kind' => 'channel']);

        return $this->shareTools[$owner] = [
            [McpScopes::CALENDAR_WRITE, CalendarShareTool::class, ['action' => 'set', 'calendarId' => 'default'], ['mayReadItems' => true]],
            [McpScopes::TASKS_WRITE, TaskListShareTool::class, ['action' => 'set', 'taskListId' => (string) $list['id']], ['mayReadItems' => true]],
            [McpScopes::NOTES_WRITE, NotebookShareTool::class, ['action' => 'set', 'notebookId' => (string) $notebook['id']], ['mayWriteAll' => true]],
            [McpScopes::CONTACTS_WRITE, AddressBookShareTool::class, ['action' => 'set', 'addressBookId' => AddressBookCollectionUris::PERSONAL_DEFAULT], ['mayRead' => true]],
            [McpScopes::MEET_WRITE, MeetChannelWriteTool::class, ['action' => 'update', 'channelId' => (string) $channel['id']], ['mayWriteAll' => true]],
        ];
    }

    /**
     * @param  class-string  $tool
     * @param  array<string, mixed>  $arguments
     */
    private function tool(string $caller, string $scope, string $tool, array $arguments): mixed
    {
        $user = User::query()->where('username', $caller)->firstOrFail();
        Passport::actingAs($user, [$scope], 'api', $this->mcpClient());

        return WorkspaceServer::actingAs($user, 'api')->tool($tool, $arguments);
    }
}
