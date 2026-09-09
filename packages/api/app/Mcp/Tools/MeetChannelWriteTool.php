<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Models\ChatChannelMeta;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsDestructive;

#[IsDestructive]
final class MeetChannelWriteTool extends WgwMcpTool
{
    protected string $name = 'meet_channel_write';

    protected string $description = 'Create, update, or delete a Meet channel or meeting; open a DM with principal.';

    /** @var list<string> */
    private const SUBSET = [
        'id',
        'name',
        'kind',
        'topic',
        'color',
        'scope',
        'groupSlug',
        'shareWith',
        'myRights',
        'isSharee',
        'guestRoomCode',
        'dmPeer',
        'memberCount',
    ];

    public function __construct(
        McpAuditLogger $audit,
        AdminRoleResolver $adminRoles,
        private ChatChannelRepository $channels,
    ) {
        parent::__construct($audit, $adminRoles);
    }

    public function schema(JsonSchema $schema): array
    {
        return [
            'action' => $schema->string()->enum(['create', 'update', 'delete'])->required()
                ->description('create, update, or delete'),
            'channelId' => $schema->string()->description('Channel id (required for update and delete)'),
            'kind' => $schema->string()->enum(['channel', 'meeting', 'dm'])->description('channel or meeting; dm opens a DM'),
            'principal' => $schema->string()->description('Peer username for DM create (POST /chat/dms)'),
            'name' => $schema->string()->description('Display name (required for channel/meeting create)'),
            'topic' => $schema->string()->nullable(),
            'color' => $schema->string()->nullable(),
            'groupSlug' => $schema->string()->nullable(),
            'shareWith' => $schema->object()->nullable()->description('Principal share map (update)'),
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
            'kind' => (string) $request->get('kind', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $action = $this->writeAction($request);
        $username = (string) $this->user()->username;
        $this->assertTextWithinCap($request->get('topic') !== null ? (string) $request->get('topic') : null, 'topic');

        if ($action === 'create') {
            return $this->json($this->subset($this->createChannel($username, $request)));
        }

        $channelId = trim((string) $request->get('channelId', ''));
        if ($channelId === '') {
            throw new \InvalidArgumentException('channelId is required.');
        }

        if ($action === 'delete') {
            return $this->json($this->channels->delete($username, $channelId));
        }

        return $this->json($this->subset($this->channels->update($username, $channelId, $this->updatePayload($request))));
    }

    /**
     * @return array<string, mixed>
     */
    private function createChannel(string $username, Request $request): array
    {
        $principal = trim((string) $request->get('principal', ''));
        $kind = strtolower(trim((string) $request->get('kind', '')));
        if ($principal !== '' || $kind === ChatChannelMeta::KIND_DM) {
            if ($principal === '') {
                throw new \InvalidArgumentException('principal is required to open a DM.');
            }

            return $this->channels->openDm($username, $principal);
        }

        $name = trim((string) $request->get('name', ''));
        if ($name === '') {
            throw new \InvalidArgumentException('name is required.');
        }
        if ($kind === '') {
            $kind = ChatChannelMeta::KIND_CHANNEL;
        }
        if (! in_array($kind, [ChatChannelMeta::KIND_CHANNEL, ChatChannelMeta::KIND_MEETING], true)) {
            throw new \InvalidArgumentException('kind must be channel or meeting.');
        }

        $payload = ['name' => $name, 'kind' => $kind];
        foreach (['topic', 'color', 'groupSlug'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }

        return $this->channels->create($username, $payload);
    }

    /**
     * @return array<string, mixed>
     */
    private function updatePayload(Request $request): array
    {
        $payload = [];
        foreach (['name', 'topic', 'color', 'groupSlug', 'shareWith'] as $key) {
            if ($request->has($key)) {
                $payload[$key] = $request->get($key);
            }
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $channel
     * @return array<string, mixed>
     */
    private function subset(array $channel): array
    {
        return $this->pick($channel, self::SUBSET);
    }
}
