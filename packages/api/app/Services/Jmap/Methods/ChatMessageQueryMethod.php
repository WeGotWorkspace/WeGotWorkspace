<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\JournalObjectIds;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\HandlesQueryArguments;

/**
 * ChatMessage/query (RFC 8620 §5.5): message ids across the channels
 * ChatMessage/get enumerates, without converting bodies, so a client can
 * list more messages than maxObjectsInGet and fetch them with explicit ids
 * (#1792). Tombstones are included, as in ChatMessage/get.
 *
 * Supports `inChannel`; ids are ordered by channel uri, then by storage
 * order. queryState is the ChatMessage/get state.
 */
final class ChatMessageQueryMethod implements JmapMethodInterface
{
    use HandlesQueryArguments;

    public function __construct(
        private readonly ChatChannelRepository $channels,
        private readonly JournalObjectIds $journalIds,
    ) {}

    public function name(): string
    {
        return 'ChatMessage/query';
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
        $filter = $this->queryFilter($args, ['inChannel']);
        $this->rejectQuerySort($args);
        [$position, $limit] = $this->queryWindowArguments($args);

        $inChannel = $filter['inChannel'] ?? null;
        if (array_key_exists('inChannel', $filter) && (! is_string($inChannel) || $inChannel === '')) {
            throw new JmapMethodException('invalidArguments', 'filter.inChannel must be a non-empty id.');
        }

        $tokens = [];
        $calendarIds = [];
        foreach ($this->channels->accessibleChatInstances($username) as $instance) {
            $uri = (string) $instance->uri;
            $tokens[$uri] = (string) (int) ($instance->calendar->synctoken ?? 1);
            $calendarIds[$uri] = (int) $instance->calendarid;
        }
        ksort($calendarIds);
        if ($inChannel !== null) {
            // A channel the caller cannot reach matches nothing.
            $calendarIds = array_intersect_key($calendarIds, [$inChannel => true]);
        }

        $ids = [];
        foreach ($calendarIds as $calendarId) {
            array_push($ids, ...$this->journalIds->inCalendar($calendarId));
        }

        return $this->queryResponse(
            $username,
            JmapAccountStateCodec::compose($tokens),
            array_values(array_unique($ids)),
            $position,
            $limit,
        );
    }
}
