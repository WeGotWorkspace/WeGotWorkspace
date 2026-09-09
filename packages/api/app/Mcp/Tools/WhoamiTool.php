<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class WhoamiTool extends WgwMcpTool
{
    protected string $name = 'whoami';

    protected string $description = 'Return the signed-in WeGotWorkspace username and role.';

    public function __construct(McpAuditLogger $audit, AdminRoleResolver $adminRoles)
    {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::SETTINGS;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return 'profile';
    }

    protected function run(Request $request): Response
    {
        return $this->json($this->principal());
    }
}
