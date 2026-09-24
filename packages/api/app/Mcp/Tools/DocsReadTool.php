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
final class DocsReadTool extends WgwMcpTool
{
    protected string $name = 'docs_read';

    protected string $description = 'Read a collaborative Doc (.md on Drive) the signed-in user can access (size capped like drive_read).';

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
            'path' => $schema->string()->required()->description('Docs file path (must end in .md)'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::DOCS_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return ['path' => (string) $request->get('path', '')];
    }

    protected function run(Request $request): Response
    {
        $path = trim((string) $request->get('path', ''));
        if ($path === '') {
            throw new \InvalidArgumentException('path is required.');
        }
        $this->assertMarkdownPath($path);

        return $this->json($this->drive->readTextPreview($this->principal(), $path, self::TEXT_MAX_BYTES));
    }
}
