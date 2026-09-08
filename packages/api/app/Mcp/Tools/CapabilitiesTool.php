<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Mcp\McpToolCatalog;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class CapabilitiesTool extends WgwMcpTool
{
    protected string $name = 'capabilities';

    protected string $description = 'List enabled MCP tools and the OAuth scopes this token holds.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private McpToolCatalog $catalog,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function requiredScope(): ?string
    {
        return null;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return null;
    }

    protected function run(Request $request): Response
    {
        $user = $this->user();
        $granted = [];
        foreach (McpScopes::ids() as $scope) {
            if ($user->tokenCan($scope)) {
                $granted[] = $scope;
            }
        }

        return $this->json([
            'tools' => array_map(
                static fn (string $class): string => (new \ReflectionClass($class))->getShortName(),
                $this->catalog->enabledTools(),
            ),
            'scopes' => $granted,
        ]);
    }
}
