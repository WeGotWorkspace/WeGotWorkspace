<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use App\Services\Search\UnifiedSearchService;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class NotesSearchTool extends WgwMcpTool
{
    protected string $name = 'notes_search';

    protected string $description = 'Search Docs and Notes the signed-in user can access.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private UnifiedSearchService $search,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'query' => $schema->string()->description('Search query'),
            'limit' => $schema->integer()->min(1)->max(50),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::DOCS;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return ['query' => (string) $request->get('query', '')];
    }

    protected function run(Request $request): Response
    {
        $validated = $request->validate([
            'query' => ['required', 'string', 'min:1'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);

        return $this->json($this->search->search(
            (string) $this->user()->username,
            (string) $validated['query'],
            (int) ($validated['limit'] ?? 20),
            ['note'],
        ));
    }
}
