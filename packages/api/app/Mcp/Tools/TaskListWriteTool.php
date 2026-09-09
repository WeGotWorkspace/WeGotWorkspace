<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Services\Tasks\TaskListRepository;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class TaskListWriteTool extends WgwMcpTool
{
    protected string $name = 'tasklist_write';

    protected string $description = 'Create, update, or delete a task list.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private TaskListRepository $lists,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'taskListId' => $schema->string()->description('Task list id (required for update and delete)'),
            'name' => $schema->string()->description('Display name'),
            'description' => $schema->string()->nullable(),
            'color' => $schema->string()->nullable(),
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
            'taskListId' => (string) $request->get('taskListId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;
        $this->assertTextWithinCap($request->get('description') !== null ? (string) $request->get('description') : null, 'description');

        if ($action === 'create') {
            $payload = $this->payload($request, requireName: true);

            return $this->json($this->subset($this->lists->create($username, $payload)));
        }

        $taskListId = trim((string) $request->get('taskListId', ''));
        if ($taskListId === '') {
            throw new \InvalidArgumentException('taskListId is required.');
        }

        if ($action === 'delete') {
            return $this->json($this->lists->delete($username, $taskListId, [
                'onDestroyRemoveContents' => (bool) $request->get('onDestroyRemoveContents', false),
            ]));
        }

        return $this->json($this->subset($this->lists->update($username, $taskListId, $this->payload($request, requireName: false))));
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Request $request, bool $requireName): array
    {
        $payload = [];
        if ($request->has('name') || $requireName) {
            $payload['name'] = (string) $request->get('name', '');
        }
        foreach (['description', 'color'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $list
     * @return array<string, mixed>
     */
    private function subset(array $list): array
    {
        return $this->pick($list, ['id', 'name', 'description', 'color', 'shareWith', 'myRights', 'scope', 'groupSlug']);
    }
}
