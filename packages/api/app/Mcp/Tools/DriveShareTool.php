<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveShareService;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;

final class DriveShareTool extends WgwMcpTool
{
    protected string $name = 'drive_share';

    protected string $description = 'Get or set Drive shares (public / member / guest + shareWith). Null grant revokes a principal.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private DriveShareService $shares,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['get', 'set'])->required()->description('get or set'),
            'path' => $schema->string()->required()->description('Drive path to share'),
            'kind' => $schema->string()->enum(['public', 'member', 'guest'])->description('Share kind for create'),
            'defaultAccess' => $schema->string()->description('Default access (view, comment, edit, full)'),
            'shareWith' => $schema->object()->nullable()
                ->description('Principal map {user: {access}, …}. Null grant revokes. Null map revokes the share.'),
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
            'path' => (string) $request->get('path', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->shareAction($request);
        $path = trim((string) $request->get('path', ''));
        if ($path === '') {
            throw new \InvalidArgumentException('path is required.');
        }

        $username = (string) $this->user()->username;
        if ($action === 'get') {
            return $this->json(['list' => $this->shares->listForOwner($username, $path)]);
        }

        $existing = $this->shares->listForOwner($username, $path);
        $shareWithPresent = $request->has('shareWith');
        $shareWith = $request->get('shareWith');

        if ($shareWithPresent && $shareWith === null && $existing !== []) {
            foreach ($existing as $share) {
                $this->shares->revokeShare($username, (string) $share['id']);
            }

            return $this->json(['ok' => true, 'revoked' => true]);
        }

        $input = ['path' => $path];
        if ($request->has('kind')) {
            $input['kind'] = (string) $request->get('kind');
        }
        if ($request->has('defaultAccess')) {
            $input['defaultAccess'] = (string) $request->get('defaultAccess');
        }
        if ($shareWithPresent && is_array($shareWith)) {
            $input['shareWith'] = $shareWith;
        }

        if ($existing === []) {
            if (! $shareWithPresent && ! $request->has('kind')) {
                throw new \InvalidArgumentException('shareWith or kind is required to create a share.');
            }

            return $this->json($this->shares->createShare($username, $input));
        }

        $share = $existing[0];
        $input['updatedAt'] = $share['updatedAt'] ?? null;

        return $this->json($this->shares->updateShare($username, (string) $share['id'], $input));
    }
}
