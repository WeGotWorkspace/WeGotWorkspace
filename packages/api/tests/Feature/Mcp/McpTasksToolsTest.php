<?php

declare(strict_types=1);

namespace Tests\Feature\Mcp;

use App\Mcp\Servers\WorkspaceServer;
use App\Mcp\Tools\TaskListShareTool;
use App\Mcp\Tools\TaskListWriteTool;
use App\Mcp\Tools\TaskWriteTool;
use App\Services\Mcp\McpScopes;
use App\Services\Tasks\InboxTaskListProvisioner;
use App\Services\Tasks\TaskListRepository;
use App\Services\Tasks\TaskRepository;
use Laravel\Passport\Passport;
use Tests\Support\ConfiguresMcp;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class McpTasksToolsTest extends WgwDatabaseTestCase
{
    use ConfiguresMcp;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->enableMcp();
    }

    public function test_task_write_denies_read_scope(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::TASKS_READ], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'create',
                'taskListId' => InboxTaskListProvisioner::URI,
                'title' => 'Blocked',
            ])
            ->assertHasErrors(['Missing OAuth scope: tasks.write']);
    }

    public function test_task_write_creates_with_due_status_priority_and_alert(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::TASKS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'create',
                'taskListId' => InboxTaskListProvisioner::URI,
                'title' => 'Ship MCP',
                'description' => 'Finish the tools',
                'due' => '2026-09-11T17:00:00',
                'workflowStatus' => 'in-process',
                'priority' => 1,
                'alerts' => [
                    'reminder' => [
                        '@type' => 'Alert',
                        'trigger' => [
                            '@type' => 'OffsetTrigger',
                            'offset' => '-PT30M',
                            'relativeTo' => 'end',
                        ],
                    ],
                ],
            ])
            ->assertOk()
            ->assertSee('Ship MCP')
            ->assertSee('Finish the tools')
            ->assertSee('in-process');
    }

    public function test_legacy_tasks_scope_can_write(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::TASKS], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'create',
                'taskListId' => InboxTaskListProvisioner::URI,
                'title' => 'Legacy task',
            ])
            ->assertOk()
            ->assertSee('Legacy task');
    }

    public function test_task_write_enforces_acl(): void
    {
        $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        $list = app(TaskListRepository::class)->create('bob', [
            'name' => 'Bob only',
            'id' => 'bob-tasks',
        ]);
        Passport::actingAs($carol, [McpScopes::TASKS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($carol, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'create',
                'taskListId' => (string) $list['id'],
                'title' => 'Nope',
            ])
            ->assertHasErrors(['Task list not found']);
    }

    public function test_tasklist_write_and_share_round_trip(): void
    {
        $bob = $this->mcpUser('bob');
        $this->mcpUser('alice');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::TASKS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(TaskListWriteTool::class, [
                'action' => 'create',
                'name' => 'Projects',
            ])
            ->assertOk()
            ->assertSee('Projects');

        $listId = $this->taskListIdNamed('bob', 'Projects');

        WorkspaceServer::actingAs($bob, 'api')
            ->tool(TaskListShareTool::class, [
                'action' => 'set',
                'taskListId' => $listId,
                'shareWith' => ['alice' => ['mayReadItems' => true]],
            ])
            ->assertOk()
            ->assertSee('alice');
    }

    public function test_tasklist_share_denies_non_owner(): void
    {
        $bob = $this->mcpUser('bob');
        $carol = $this->mcpUser('carol');
        $client = $this->mcpClient();
        Passport::actingAs($bob, [McpScopes::TASKS_WRITE], 'api', $client);
        WorkspaceServer::actingAs($bob, 'api')
            ->tool(TaskListWriteTool::class, ['action' => 'create', 'name' => 'Private'])
            ->assertOk();
        $listId = $this->taskListIdNamed('bob', 'Private');

        Passport::actingAs($carol, [McpScopes::TASKS_WRITE], 'api', $client);
        WorkspaceServer::actingAs($carol, 'api')
            ->tool(TaskListShareTool::class, [
                'action' => 'set',
                'taskListId' => $listId,
                'shareWith' => ['bob' => ['mayReadItems' => true]],
            ])
            ->assertHasErrors(['Task list not found']);
    }

    public function test_task_write_update_and_delete(): void
    {
        $user = $this->mcpUser('bob');
        $client = $this->mcpClient();
        Passport::actingAs($user, [McpScopes::TASKS_WRITE], 'api', $client);

        WorkspaceServer::actingAs($user, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'create',
                'taskListId' => InboxTaskListProvisioner::URI,
                'title' => 'Draft',
            ])
            ->assertOk();
        $taskId = $this->taskIdNamed('bob', InboxTaskListProvisioner::URI, 'Draft');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'update',
                'taskId' => $taskId,
                'title' => 'Draft',
                'workflowStatus' => 'completed',
            ])
            ->assertOk()
            ->assertSee('completed');

        WorkspaceServer::actingAs($user, 'api')
            ->tool(TaskWriteTool::class, [
                'action' => 'delete',
                'taskId' => $taskId,
            ])
            ->assertOk()
            ->assertSee('ok');
    }

    private function taskListIdNamed(string $username, string $name): string
    {
        $row = collect(app(TaskListRepository::class)->list($username)['list'])
            ->first(static fn (array $list): bool => ($list['name'] ?? '') === $name);
        $this->assertIsArray($row);

        return (string) $row['id'];
    }

    private function taskIdNamed(string $username, string $taskListId, string $title): string
    {
        $row = collect(app(TaskRepository::class)->list($username, $taskListId)['list'])
            ->first(static fn (array $task): bool => ($task['title'] ?? '') === $title);
        $this->assertIsArray($row);

        return (string) $row['id'];
    }
}
