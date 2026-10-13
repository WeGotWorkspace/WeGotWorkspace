<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Mcp\McpMemberShareCommand;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;

final class DocsShareTool extends WgwMcpTool
{
    protected string $name = 'docs_share';

    protected string $description = 'Get or set member Drive shares for a Doc (.md). Public links and guest email invites are refused.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private McpMemberShareCommand $shares,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['get', 'set'])->required()->description('get or set'),
            'path' => $schema->string()->required()->description('Docs file path (must end in .md)'),
            'kind' => $schema->string()->enum(['member'])->description('Share kind. Only member is accepted.'),
            'defaultAccess' => $schema->string()->description('Default access (view, comment, edit, full)'),
            'shareWith' => $schema->object()->nullable()
                ->description('Principal map {user: {access}, …}. Null grant revokes. Null map revokes the share.'),
        ];
    }

    protected function requiredScope(): string
    {
        return McpScopes::DRIVE_SHARE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array
    {
        return [
            'action' => (string) $request->get('action', ''),
            'path' => (string) $request->get('path', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        McpScopes::assertLaunchMemberShare(
            $request->get('kind'),
            $request->has('shareWith') ? $request->get('shareWith') : null,
        );

        $action = $this->shareAction($request);
        $path = trim((string) $request->get('path', ''));
        if ($path === '') {
            throw new \InvalidArgumentException('path is required.');
        }
        $this->assertMarkdownPath($path);

        $username = (string) $this->user()->username;
        if ($action === 'get') {
            return $this->json(['list' => $this->shares->listForOwner($username, $path)]);
        }

        return $this->json($this->shares->set($username, $path, [
            'hasKind' => $request->has('kind'),
            'shareWithPresent' => $request->has('shareWith'),
            'shareWith' => $request->get('shareWith'),
            'defaultAccess' => $request->has('defaultAccess') ? (string) $request->get('defaultAccess') : null,
        ]));
    }
}
