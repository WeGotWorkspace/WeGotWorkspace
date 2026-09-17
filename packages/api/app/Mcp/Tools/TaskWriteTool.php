<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Services\Tasks\TaskRepository;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class TaskWriteTool extends WgwMcpTool
{
    protected string $name = 'task_write';

    protected string $description = 'Create, update, or delete a task (list, due, status, priority, reminders).';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private TaskRepository $tasks,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'taskId' => $schema->string()->description('Task id (required for update and delete)'),
            'taskListId' => $schema->string()->description('Task list id (required for create)'),
            'title' => $schema->string()->description('Task title'),
            'description' => $schema->string()->nullable()->description('Task notes'),
            'due' => $schema->string()->nullable()->description('Due date-time'),
            'timeZone' => $schema->string()->nullable(),
            'showWithoutTime' => $schema->boolean(),
            'workflowStatus' => $schema->string()
                ->enum(['needs-action', 'in-process', 'completed', 'cancelled', 'pending', 'failed']),
            'priority' => $schema->integer()->min(0)->max(9)->nullable(),
            'alerts' => $schema->object()->description('JSCalendar alerts map (VALARM reminders)'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::TASKS_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'taskId' => (string) $request->get('taskId', ''),
            'taskListId' => (string) $request->get('taskListId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;

        if ($action === 'delete') {
            $taskId = $this->requiredId($request, 'taskId');

            return $this->json($this->tasks->delete($username, $taskId, null, null, false));
        }

        $payload = $this->taskPayload($request);
        if ($action === 'create') {
            $taskListId = trim((string) $request->get('taskListId', ''));
            if ($taskListId === '') {
                throw new \InvalidArgumentException('taskListId is required.');
            }
            $payload['taskListIds'] = [$taskListId => true];

            return $this->json($this->subset($this->tasks->create($username, $payload)));
        }

        $taskId = $this->requiredId($request, 'taskId');

        return $this->json($this->subset(
            $this->tasks->patch($username, $taskId, $payload, null, null, false),
        ));
    }

    /**
     * @return array<string, mixed>
     */
    private function taskPayload(Request $request): array
    {
        $payload = [];
        foreach (['title', 'description', 'due', 'timeZone', 'workflowStatus'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }
        if (isset($payload['description']) && is_string($payload['description'])) {
            $this->assertTextWithinCap($payload['description'], 'description');
        }
        if ($request->has('showWithoutTime')) {
            $payload['showWithoutTime'] = (bool) $request->get('showWithoutTime');
        }
        if ($request->has('priority')) {
            $payload['priority'] = $request->get('priority') === null ? null : (int) $request->get('priority');
        }
        if ($request->has('alerts')) {
            $alerts = $request->get('alerts');
            if ($alerts !== null && ! is_array($alerts)) {
                throw new \InvalidArgumentException('alerts must be an object.');
            }
            $payload['alerts'] = $alerts;
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    private function subset(array $task): array
    {
        return $this->pick($task, [
            'id',
            'taskListId',
            'uid',
            'title',
            'description',
            'due',
            'start',
            'timeZone',
            'showWithoutTime',
            'workflowStatus',
            'priority',
            'alerts',
        ]);
    }

    private function requiredId(Request $request, string $key): string
    {
        $id = trim((string) $request->get($key, ''));
        if ($id === '') {
            throw new \InvalidArgumentException($key.' is required.');
        }

        return $id;
    }
}
