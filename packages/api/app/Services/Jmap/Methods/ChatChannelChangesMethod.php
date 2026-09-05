<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Chat\ChatChannelRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * ChatChannel/changes: existence/token diff via the envelope codec (Notes
 * recipe: NotebookChangesMethod). A destroyed channel id here is the client's
 * cue to prune that channel's cached messages — ChatMessage/changes does not
 * re-enumerate them (meet-chat-client.md, "JMAP contract assumptions").
 */
final class ChatChannelChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(private readonly ChatChannelRepository $channels) {}

    public function name(): string
    {
        return 'ChatChannel/changes';
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
        $sinceState = $this->sinceState($args);
        $since = JmapAccountStateCodec::decompose($sinceState);
        if ($since === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        $current = $this->channels->channelSyncTokens($username);

        $created = [];
        $updated = [];
        foreach ($current as $uri => $token) {
            if (! array_key_exists($uri, $since)) {
                $created[] = $uri;
            } elseif ($since[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($since) as $uri) {
            if (! array_key_exists($uri, $current)) {
                $destroyed[] = $uri;
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => JmapAccountStateCodec::compose($current),
            'hasMoreChanges' => false,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }
}
