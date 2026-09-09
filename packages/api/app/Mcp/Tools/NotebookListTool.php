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
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class NotebookListTool extends WgwMcpTool
{
    protected string $name = 'notebook_list';

    protected string $description = 'List notebooks the signed-in user can access.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private NotebookRepository $notebooks,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::NOTES_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return 'notebooks';
    }

    protected function run(Request $request): Response
    {
        $listed = $this->notebooks->list((string) $this->user()->username);
        $list = [];
        foreach ($listed['list'] as $notebook) {
            $list[] = $this->pick($notebook, ['id', 'name', 'description', 'color', 'shareWith', 'myRights', 'scope', 'groupSlug', 'isDefault']);
        }

        return $this->json(['list' => $list]);
    }
}
