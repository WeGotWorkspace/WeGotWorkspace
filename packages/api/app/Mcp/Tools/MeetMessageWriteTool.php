<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Chat\ChatMessageRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class MeetMessageWriteTool extends WgwMcpTool
{
    protected string $name = 'meet_message_write';

    protected string $description = 'Send, edit, or delete a Meet channel message.';

    /** @var list<string> */
    private const SUBSET = [
        'id',
        'channelId',
        'authorId',
        'authorName',
        'body',
        'createdAt',
        'editedAt',
        'deletedAt',
        'parentId',
        'replyCount',
    ];

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private ChatMessageRepository $messages,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create (send), update (edit), or delete'),
            'channelId' => $schema->string()->description('Channel id (required for create)'),
            'messageId' => $schema->string()->description('Message id (create may omit; generated ULID). Required for update/delete'),
            'body' => $schema->string()->description('Message body (create and update)'),
            'parentId' => $schema->string()->nullable()->description('Parent message id for a thread reply'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::MEET_WRITE;
    }

    protected function accessMode(): string
    {
        return 'write';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'action' => (string) $request->get('action', ''),
            'channelId' => (string) $request->get('channelId', ''),
            'messageId' => (string) $request->get('messageId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;

        if ($action === 'delete') {
            $messageId = $this->requiredMessageId($request);

            return $this->json($this->messages->delete($username, $messageId));
        }

        $body = (string) $request->get('body', '');
        $this->assertTextWithinCap($body, 'body');
        if (trim($body) === '') {
            throw new \InvalidArgumentException('body is required.');
        }

        if ($action === 'create') {
            $channelId = trim((string) $request->get('channelId', ''));
            if ($channelId === '') {
                throw new \InvalidArgumentException('channelId is required.');
            }
            $id = trim((string) $request->get('messageId', ''));
            if ($id === '') {
                $id = (string) Str::ulid();
            }
            $payload = ['id' => $id, 'body' => $body];
            $parentId = $request->has('parentId') ? $request->get('parentId') : null;
            if (is_string($parentId) && $parentId !== '') {
                $payload['parentId'] = $parentId;
            }
            $created = $this->messages->create($username, $channelId, $payload);

            return $this->json($this->subset($created['message']));
        }

        return $this->json($this->subset(
            $this->messages->edit($username, $this->requiredMessageId($request), $body),
        ));
    }

    /**
     * @param  array<string, mixed>  $message
     * @return array<string, mixed>
     */
    private function subset(array $message): array
    {
        return $this->pick($message, self::SUBSET);
    }

    private function requiredMessageId(Request $request): string
    {
        $id = trim((string) $request->get('messageId', ''));
        if ($id === '') {
            throw new \InvalidArgumentException('messageId is required.');
        }

        return $id;
    }
}
