<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Models\CalendarInstance;
use App\Services\Chat\ChatChangesFeed;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * Account-wide ChatMessage/changes fan-out over chat channel collections —
 * the Notes recipe (NoteChangesMethod + JmapAccountStateCodec) with two
 * chat-specific differences:
 *
 * - `hasMoreChanges` is real (meet-chat-client.md §5): channels are drained
 *   in deterministic uri order against a per-call budget; when a channel's
 *   feed truncates (ChatChangesFeed) or the budget runs out, the composed
 *   newState carries the partial per-channel resume token / the untouched
 *   since tokens, so repeating the call with newState resumes without loss
 *   or duplication.
 * - A channel that disappeared since sinceState (deleted, unshared,
 *   dismissed) yields NO per-message destroyed ids: the client prunes the
 *   channel's messages when ChatChannel/changes reports the channel id in
 *   `destroyed` (verified against meet-chat-jmap-inbound.ts), so the
 *   JmapNoteStateService-style bookkeeping table is deliberately not needed
 *   at chat volume. Message-level `destroyed` therefore only carries hard
 *   object removals inside live channels (which no REST path produces —
 *   deletes are tombstones surfacing as `updated`).
 * - A channel that APPEARED since sinceState is primed at its current token
 *   without replaying its history as `created`: Sabre's initial-sync path
 *   ignores the row limit (an unbounded response at chat volume), and the
 *   client contract mandates a one-time REST history backfill when
 *   ChatChannel/changes reports a created channel (meet-chat-client.md §4).
 */
final class ChatMessageChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    /** Per-call budget when the client sends no maxChanges. */
    public const DEFAULT_MAX_CHANGES = 200;

    public function __construct(
        private readonly ChatChannelRepository $channels,
        private readonly ChatChangesFeed $feed,
    ) {}

    public function name(): string
    {
        return 'ChatMessage/changes';
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

        $maxChanges = $args['maxChanges'] ?? null;
        $remaining = is_int($maxChanges) ? min($maxChanges, self::DEFAULT_MAX_CHANGES) : self::DEFAULT_MAX_CHANGES;

        /** @var array<string, CalendarInstance> $instances */
        $instances = [];
        $current = [];
        foreach ($this->channels->accessibleChatInstances($username) as $instance) {
            $uri = (string) $instance->uri;
            $instances[$uri] = $instance;
            $current[$uri] = (string) (int) ($instance->calendar?->synctoken ?? 1);
        }
        ksort($current);

        // Vanished channels drop out of the composed state silently — their
        // messages are pruned client-side via ChatChannel/changes.destroyed.
        $newState = array_intersect_key($since, $current);

        $created = [];
        $updated = [];
        $destroyed = [];
        $hasMoreChanges = false;
        foreach ($current as $uri => $token) {
            $sinceToken = $since[$uri] ?? null;
            if ($sinceToken === null) {
                // New channel: prime at the current token; history arrives
                // via the client's REST backfill, not as created ids.
                $newState[$uri] = $token;

                continue;
            }
            if ($sinceToken === $token) {
                $newState[$uri] = $token;

                continue;
            }
            if ($hasMoreChanges || $remaining <= 0) {
                // Budget spent: freeze this channel at its since token (or
                // keep it absent when new) and let the client loop.
                $hasMoreChanges = true;

                continue;
            }

            $delta = $this->feed->changes($instances[$uri], $sinceToken, $remaining);
            array_push($created, ...$delta['created']);
            array_push($updated, ...$delta['updated']);
            array_push($destroyed, ...$delta['destroyed']);
            $newState[$uri] = $delta['newState'];
            $remaining -= count($delta['created']) + count($delta['updated']) + count($delta['destroyed']);
            if ($delta['hasMoreChanges']) {
                $hasMoreChanges = true;
            }
        }

        $created = array_values(array_unique($created));
        $updated = array_values(array_diff(array_unique($updated), $created));
        $destroyed = array_values(array_diff(array_unique($destroyed), $created, $updated));

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => JmapAccountStateCodec::compose($newState),
            'hasMoreChanges' => $hasMoreChanges,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }
}
