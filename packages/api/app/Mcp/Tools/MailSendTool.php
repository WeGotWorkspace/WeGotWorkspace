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
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class MailSendTool extends WgwMcpTool
{
    protected string $name = 'mail_send';

    protected string $description = 'Send mail as the signed-in user.';

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private MailOperationService $mail,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'to' => $schema->string()->description('Recipient address'),
            'subject' => $schema->string()->description('Subject'),
            'body' => $schema->string()->description('Plain-text body'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::MAIL_SEND;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return ['to' => (string) $request->get('to', '')];
    }

    protected function run(Request $request): Response
    {
        $validated = $request->validate([
            'to' => ['required', 'string'],
            'subject' => ['nullable', 'string'],
            'body' => ['nullable', 'string'],
        ]);

        return $this->json($this->mail->send((string) $this->user()->username, $validated));
    }
}
