<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Services\Notes\NotebookRepository;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;

final class NotebookShareTool extends WgwMcpTool
{
    protected string $name = 'notebook_share';

    protected string $description = 'Get or set notebook shareWith. Null grant revokes a principal.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private NotebookRepository $notebooks,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['get', 'set'])->required()->description('get or set'),
            'notebookId' => $schema->string()->required()->description('Notebook id'),
            'shareWith' => $schema->object()->nullable()
                ->description('Principal map. Omit/null grant revokes. Null map revokes all.'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::NOTES_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'notebookId' => (string) $request->get('notebookId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->shareAction($request);
        $notebookId = trim((string) $request->get('notebookId', ''));
        if ($notebookId === '') {
            throw new \InvalidArgumentException('notebookId is required.');
        }

        $username = (string) $this->user()->username;
        if ($action === 'get') {
            $notebook = $this->notebooks->show($username, $notebookId);

            return $this->json($this->pick($notebook, ['id', 'name', 'shareWith', 'myRights']));
        }

        if (! $request->has('shareWith')) {
            throw new \InvalidArgumentException('shareWith is required for set (object or null).');
        }

        $updated = $this->notebooks->update($username, $notebookId, [
            'shareWith' => $request->get('shareWith'),
        ]);

        return $this->json($this->pick($updated, ['id', 'name', 'shareWith', 'myRights']));
    }
}
