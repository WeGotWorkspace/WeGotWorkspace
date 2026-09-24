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
final class DocsWriteTool extends WgwMcpTool
{
    protected string $name = 'docs_write';

    protected string $description = 'Create, update, or delete a collaborative Doc (.md text on Drive). Not Yjs.';

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
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'path' => $schema->string()->required()->description('Docs file path (must end in .md)'),
            'text' => $schema->string()->description('Markdown text (create and update)'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::DOCS_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'path' => (string) $request->get('path', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $path = trim((string) $request->get('path', ''));
        if ($path === '') {
            throw new \InvalidArgumentException('path is required.');
        }
        $this->assertMarkdownPath($path);

        $principal = $this->principal();
        if ($action === 'delete') {
            return $this->json([
                'ok' => true,
                'result' => $this->drive->deleteItems($principal, [['path' => $path]]),
            ]);
        }

        $text = (string) $request->get('text', '');
        $this->assertTextWithinCap($text);
        $exists = $this->markdownExists($principal, $path);
        if ($action === 'create' && $exists) {
            throw new \InvalidArgumentException('A Doc already exists at this path.');
        }
        if ($action === 'update' && ! $exists) {
            throw new \InvalidArgumentException('Doc not found.');
        }

        return $this->json($this->drive->writeText($principal, $path, $text, self::TEXT_MAX_BYTES));
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function markdownExists(array $principal, string $path): bool
    {
        try {
            $this->drive->assertReadableFile($principal, $path);

            return true;
        } catch (\InvalidArgumentException $e) {
            $message = $e->getMessage();
            if (str_contains($message, 'not found')) {
                return false;
            }

            throw $e;
        }
    }
}
