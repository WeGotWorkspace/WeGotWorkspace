<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Models\CalendarObject;
use App\Models\ChatReadMarker;
use App\Services\Chat\Conversion\ChatMessageJournalConverter;
use DateTimeImmutable;

/**
 * Unread messages per channel: messages with (created_ts, uid) strictly after
 * the caller's read marker, excluding the caller's own messages and delete
 * tombstones. Without a marker every foreign message counts as unread.
 */
final class ChatUnreadCounter
{
    public function __construct(private readonly ChatMessageJournalConverter $converter) {}

    public function count(string $username, int $calendarId): int
    {
        $marker = ChatReadMarker::query()
            ->where('username', $username)
            ->where('calendarid', $calendarId)
            ->first();
        $markerTs = $marker !== null ? (int) $marker->last_read_ts : null;
        $markerUid = $marker !== null ? (string) $marker->last_read_uid : '';

        $unread = 0;
        $objects = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('componenttype', 'VJOURNAL')
            ->get(['uid', 'calendardata']);
        foreach ($objects as $object) {
            $message = $this->converter->fromIcs(
                is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata,
                (string) $object->uid,
            );
            if (($message['authorId'] ?? '') === $username || ($message['deletedAt'] ?? null) !== null) {
                continue;
            }
            if ($markerTs === null) {
                $unread++;

                continue;
            }
            $createdTs = $this->epoch((string) ($message['createdAt'] ?? ''));
            $uid = (string) ($message['id'] ?? '');
            if ($createdTs > $markerTs || ($createdTs === $markerTs && strcmp($uid, $markerUid) > 0)) {
                $unread++;
            }
        }

        return $unread;
    }

    private function epoch(string $utcDateTime): int
    {
        if ($utcDateTime === '') {
            return 0;
        }
        try {
            return (new DateTimeImmutable($utcDateTime))->getTimestamp();
        } catch (\Throwable) {
            return 0;
        }
    }
}
