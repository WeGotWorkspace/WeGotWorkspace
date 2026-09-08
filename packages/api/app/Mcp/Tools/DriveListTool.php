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
final class DriveListTool extends WgwMcpTool
{
    protected string $name = 'drive_list';

    protected string $description = 'List a Drive directory the signed-in user can view.';

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
            'path' => $schema->string()->description('Directory path (default /)'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::DRIVE;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return ['path' => (string) $request->get('path', '/')];
    }

    protected function run(Request $request): Response
    {
        $path = (string) $request->get('path', '/');

        return $this->json($this->drive->listDirectory($this->principal(), $path !== '' ? $path : '/'));
    }
}
