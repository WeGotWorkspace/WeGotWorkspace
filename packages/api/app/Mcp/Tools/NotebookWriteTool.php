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
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class NotebookWriteTool extends WgwMcpTool
{
    protected string $name = 'notebook_write';

    protected string $description = 'Create, update, or delete a notebook.';

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
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'notebookId' => $schema->string()->description('Notebook id (required for update and delete)'),
            'name' => $schema->string()->description('Display name'),
            'description' => $schema->string()->nullable(),
            'color' => $schema->string()->nullable(),
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
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;
        $this->assertTextWithinCap($request->get('description') !== null ? (string) $request->get('description') : null, 'description');

        if ($action === 'create') {
            $payload = $this->payload($request, requireName: true);

            return $this->json($this->subset($this->notebooks->create($username, $payload)));
        }

        $notebookId = trim((string) $request->get('notebookId', ''));
        if ($notebookId === '') {
            throw new \InvalidArgumentException('notebookId is required.');
        }

        if ($action === 'delete') {
            return $this->json($this->notebooks->delete($username, $notebookId, [
                'onDestroyRemoveContents' => (bool) $request->get('onDestroyRemoveContents', false),
            ]));
        }

        return $this->json($this->subset($this->notebooks->update($username, $notebookId, $this->payload($request, requireName: false))));
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
     * @param  array<string, mixed>  $notebook
     * @return array<string, mixed>
     */
    private function subset(array $notebook): array
    {
        return $this->pick($notebook, ['id', 'name', 'description', 'color', 'shareWith', 'myRights', 'scope', 'groupSlug']);
    }
}
