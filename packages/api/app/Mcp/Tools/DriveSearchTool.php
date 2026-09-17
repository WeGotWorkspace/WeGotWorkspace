<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveService;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class DriveSearchTool extends WgwMcpTool
{
    protected string $name = 'drive_search';

    protected string $description = 'Search Drive files the signed-in user can access.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private DriveService $drive,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'query' => $schema->string()->min(2)->description('Search query'),
            'limit' => $schema->integer()->min(1)->max(100)->description('Max results (default 20)'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::DRIVE_READ;
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
            'query' => ['required', 'string', 'min:2'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return $this->json($this->drive->search(
            (string) $this->user()->username,
            (string) $validated['query'],
            (int) ($validated['limit'] ?? 20),
        ));
    }
}
