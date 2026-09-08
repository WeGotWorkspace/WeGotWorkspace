<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Chat\ChatChannelRepository;
use App\Services\Chat\ChatMessageRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * ChatMessage/get: explicit ids via ChatMessageRepository::getByIds();
 * ids null enumerates every accessible channel (Notes recipe: NoteGetMethod).
 * Objects mirror the REST ChatMessage schema field-for-field, tombstones
 * included (deletedAt set, body empty) — the client relies on tombstones
 * arriving through /get after an `updated` change id.
 */
final class ChatMessageGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(
        private readonly ChatChannelRepository $channels,
        private readonly ChatMessageRepository $messages,
    ) {}

    public function name(): string
    {
        return 'ChatMessage/get';
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
        $tokens = $this->channels->channelSyncTokens($username);
        $state = JmapAccountStateCodec::compose($tokens);

        $ids = $this->requestedIds($args);
        $notFound = [];
        if ($ids === null) {
            $list = [];
            foreach (array_keys($tokens) as $channelId) {
                foreach ($this->messages->listAll($username, $channelId) as $message) {
                    $list[] = $message;
                }
            }
            $this->guardGetAllBound($list);
        } else {
            $result = $this->messages->getByIds($username, $ids);
            $list = $result['list'];
            $notFound = $result['notFound'];
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
