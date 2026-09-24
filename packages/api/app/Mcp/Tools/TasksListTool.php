<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Services\Tasks\TaskListRepository;
use App\Services\Tasks\TaskRepository;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class TasksListTool extends WgwMcpTool
{
    protected string $name = 'tasks_list';

    protected string $description = 'List task lists, or tasks in a given list.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private TaskListRepository $lists,
        private TaskRepository $tasks,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'taskListId' => $schema->string()->description('Optional task list id. Omit to list lists.'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::TASKS_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return ['taskListId' => $request->get('taskListId')];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $taskListId = $request->get('taskListId');
        if (! is_string($taskListId) || trim($taskListId) === '') {
            return $this->json($this->lists->list($username));
        }

        return $this->json($this->tasks->list($username, $taskListId));
    }
}
