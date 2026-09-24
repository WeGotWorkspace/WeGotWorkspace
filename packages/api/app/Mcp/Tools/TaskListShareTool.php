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

final class TaskListShareTool extends WgwMcpTool
{
    protected string $name = 'tasklist_share';

    protected string $description = 'Get or set task list shareWith. Null grant revokes a principal.';

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
            'action' => $schema->string()->enum(['get', 'set'])->required()->description('get or set'),
            'taskListId' => $schema->string()->required()->description('Task list id'),
            'shareWith' => $schema->object()->nullable()
                ->description('Principal map. Omit/null grant revokes. Null map revokes all.'),
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
        $action = $this->shareAction($request);
        $taskListId = trim((string) $request->get('taskListId', ''));
        if ($taskListId === '') {
            throw new \InvalidArgumentException('taskListId is required.');
        }

        $username = (string) $this->user()->username;
        if ($action === 'get') {
            $list = $this->lists->show($username, $taskListId);

            return $this->json($this->pick($list, ['id', 'name', 'shareWith', 'myRights']));
        }

        if (! $request->has('shareWith')) {
            throw new \InvalidArgumentException('shareWith is required for set (object or null).');
        }

        $updated = $this->lists->update($username, $taskListId, [
            'shareWith' => $request->get('shareWith'),
        ]);

        return $this->json($this->pick($updated, ['id', 'name', 'shareWith', 'myRights']));
    }
}
