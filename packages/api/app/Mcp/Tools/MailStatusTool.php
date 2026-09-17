<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Mail\MailOperationService;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class MailStatusTool extends WgwMcpTool
{
    protected string $name = 'mail_status';

    protected string $description = 'Read mailbox configuration status for the signed-in user (no message bodies).';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private MailOperationService $mail,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::MAIL_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return 'mail-status';
    }

    protected function run(Request $request): Response
    {
        return $this->json($this->mail->status((string) $this->user()->username));
    }
}
