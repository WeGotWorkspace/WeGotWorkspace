<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Chat\ChatMessageRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class MeetMessageListTool extends WgwMcpTool
{
    protected string $name = 'meet_message_list';

    protected string $description = 'List or get Meet channel messages.';

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
            'channelId' => $schema->string()->description('Channel id (required to list)'),
            'messageId' => $schema->string()->description('Message id. When set, returns that message.'),
            'limit' => $schema->integer()->min(1)->max(200)->description('Page size (default 50)'),
        ];
    }

    protected function requiredScope(): ?string
    {
        return McpScopes::MEET_READ;
    }

    protected function accessMode(): string
    {
        return 'read';
    }

    protected function target(Request $request): array|string|null
    {
        return [
            'channelId' => (string) $request->get('channelId', ''),
            'messageId' => (string) $request->get('messageId', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $messageId = trim((string) $request->get('messageId', ''));
        if ($messageId !== '') {
            $found = $this->messages->getByIds($username, [$messageId]);
            $row = $found['list'][0] ?? null;
            if (! is_array($row)) {
                throw new \InvalidArgumentException('Message not found.');
            }

            return $this->json($this->subset($row));
        }

        $channelId = trim((string) $request->get('channelId', ''));
        if ($channelId === '') {
            throw new \InvalidArgumentException('channelId or messageId is required.');
        }

        $listed = $this->messages->list(
            $username,
            $channelId,
            null,
            null,
            is_numeric($request->get('limit')) ? (int) $request->get('limit') : null,
        );
        $list = [];
        foreach ($listed['list'] as $message) {
            $list[] = $this->subset($message);
        }

        return $this->json(['list' => $list, 'hasMore' => $listed['hasMore']]);
    }

    /**
     * @param  array<string, mixed>  $message
     * @return array<string, mixed>
     */
    private function subset(array $message): array
    {
        $row = $this->pick($message, self::SUBSET);
        if (isset($row['body']) && is_string($row['body']) && strlen($row['body']) > self::TEXT_MAX_BYTES) {
            $row['body'] = substr($row['body'], 0, self::TEXT_MAX_BYTES);
            $row['truncated'] = true;
        }

        return $row;
    }
}
