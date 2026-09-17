<?php

declare(strict_types=1);

namespace App\Mcp\Tools;

use App\Services\Auth\AdminRoleResolver;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpScopes;
use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tools\Annotations\IsReadOnly;

#[IsReadOnly]
final class MeetChannelListTool extends WgwMcpTool
{
    protected string $name = 'meet_channel_list';

    protected string $description = 'List or get Meet chat channels (kind channel, meeting, or DM).';

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
            'channelId' => $schema->string()->description('Channel id. When set, returns that channel.'),
            'kind' => $schema->string()->enum(['channel', 'meeting', 'dm'])->description('Filter list by kind'),
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
            'kind' => (string) $request->get('kind', ''),
        ];
    }

    protected function run(Request $request): Response
    {
        $username = (string) $this->user()->username;
        $channelId = trim((string) $request->get('channelId', ''));
        if ($channelId !== '') {
            return $this->json($this->subset($this->channels->show($username, $channelId)));
        }

        $kind = strtolower(trim((string) $request->get('kind', '')));
        $list = [];
        foreach ($this->channels->list($username)['list'] as $channel) {
            if ($kind !== '' && (string) ($channel['kind'] ?? '') !== $kind) {
                continue;
            }
            $list[] = $this->subset($channel);
        }

        return $this->json(['list' => $list]);
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
