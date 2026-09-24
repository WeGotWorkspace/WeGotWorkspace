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
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class DriveWriteTool extends WgwMcpTool
{
    protected string $name = 'drive_write';

    protected string $description = 'Create a folder, write a small text file, move, or delete a Drive path.';

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
            'action' => $schema->string()->enum(['mkdir', 'write_text', 'move', 'delete'])->required()
                ->description('mkdir, write_text, move, or delete'),
            'path' => $schema->string()->description('Target path (mkdir, write_text, delete)'),
            'text' => $schema->string()->description('Text contents for write_text'),
            'from' => $schema->string()->description('Source path for move'),
            'to' => $schema->string()->description('Destination path for move'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::DRIVE_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'path' => (string) $request->get('path', $request->get('from', '')),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = strtolower(trim((string) $request->get('action', '')));
        if (! in_array($action, ['mkdir', 'write_text', 'move', 'delete'], true)) {
            throw new \InvalidArgumentException('action must be mkdir, write_text, move, or delete.');
        }

        $principal = $this->principal();

        if ($action === 'mkdir') {
            $path = $this->requiredPath($request, 'path');

            return $this->json($this->drive->mkdir($principal, $path));
        }

        if ($action === 'write_text') {
            $path = $this->requiredPath($request, 'path');
            $text = (string) $request->get('text', '');
            $this->assertTextWithinCap($text);

            return $this->json($this->drive->writeText($principal, $path, $text, self::TEXT_MAX_BYTES));
        }

        if ($action === 'move') {
            $from = $this->requiredPath($request, 'from');
            $to = $this->requiredPath($request, 'to');

            return $this->json($this->drive->movePath($principal, $from, $to));
        }

        $path = $this->requiredPath($request, 'path');

        return $this->json([
            'ok' => true,
            'result' => $this->drive->deleteItems($principal, [['path' => $path]]),
        ]);
    }

    private function requiredPath(Request $request, string $key): string
    {
        $path = trim((string) $request->get($key, ''));
        if ($path === '') {
            throw new \InvalidArgumentException($key.' is required.');
        }

        return $path;
    }
}
