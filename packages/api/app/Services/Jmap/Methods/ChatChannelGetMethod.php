<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Chat\ChatChannelRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * ChatChannel/get over ChatChannelRepository::list() with envelope-codec
 * state (Notes recipe: NotebookGetMethod). Objects mirror the REST
 * ChatChannel schema field-for-field — the client casts JMAP objects to the
 * generated REST types (packages/apps/docs/meet-chat-client.md §3).
 */
final class ChatChannelGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly ChatChannelRepository $channels) {}

    public function name(): string
    {
        return 'ChatChannel/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::CHAT;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $state = JmapAccountStateCodec::compose($this->channels->channelSyncTokens($username));
        $all = $this->channels->list($username)['list'];

        $ids = $this->requestedIds($args);
        $notFound = [];
        if ($ids === null) {
            $this->guardGetAllBound($all);
            $list = $all;
        } else {
            $byId = [];
            foreach ($all as $channel) {
                $byId[(string) $channel['id']] = $channel;
            }
            $list = [];
            foreach ($ids as $id) {
                if (isset($byId[$id])) {
                    $list[] = $byId[$id];
                } else {
                    $notFound[] = $id;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
