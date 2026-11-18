<?php

declare(strict_types=1);

namespace App\Services\Chat\Conversion;

use App\Models\CalendarObject;
use App\Services\Threads\ThreadEntryJournal;
use DateTimeImmutable;

/**
 * Chat message <-> VJOURNAL mapping (Epic #701; mirrors NoteJournalConverter).
 *
 * VJOURNAL is a serialization format here, not a semantic fit — these objects
 * are never DAV-visible (WgwCalendarBackend):
 * - UID           = message id, client-generated ULID (idempotent retries,
 *                   lexicographically time-sortable read-marker tiebreak)
 * - DTSTAMP       = server-assigned created timestamp, never touched again —
 *                   the ordering source of truth together with the UID
 * - DESCRIPTION   = body (cleared on tombstones)
 * - X-WGW-AUTHOR  = author principal username
 * - RELATED-TO    = thread parent message id
 * - SEQUENCE      = bumped ONLY on author body edits (LWW for edits); reaction
 *                   toggles and tombstones never touch it
 * - LAST-MODIFIED = last author body edit (editedAt)
 * - STATUS:CANCELLED + X-WGW-DELETED-AT = delete tombstone
 * - X-WGW-REACTIONS = JSON array [{emoji, authors: [username]}], rewritten
 *                   server-side inside a transaction (OR-set toggle semantics)
 * - X-WGW-MENTIONS  = JSON array [{id, displayName}] of @principals
 *
 * All of these live in the shared ThreadEntryJournal (#2173 chunk A); this
 * class keeps Chat's property order, error wording and read shape.
 */
final class ChatMessageJournalConverter
{
    public const MAX_BODY_BYTES = ThreadEntryJournal::MAX_BODY_BYTES;

    private const LABEL = 'Message';

    private readonly ThreadEntryJournal $journal;

    public function __construct()
    {
        $this->journal = new ThreadEntryJournal(self::LABEL);
    }

    public static function normalizeUlid(string $id): string
    {
        return ThreadEntryJournal::normalizeUlid($id, self::LABEL);
    }

    /**
     * @param  array{id: string, body: string, author: string, parentId?: string|null, mentions?: list<array{id: string, displayName?: string}>}  $message
     */
    public function toIcs(array $message, DateTimeImmutable $createdAt): string
    {
        [$calendar, $journal] = $this->journal->create(
            (string) $message['id'],
            $createdAt,
            (string) $message['body'],
            (string) $message['author'],
        );
        $this->journal->addParent($journal, $message['parentId'] ?? null);
        $this->journal->addMentions($journal, $message['mentions'] ?? []);
        $journal->SEQUENCE = 0;

        return $calendar->serialize();
    }

    /**
     * Author body edit: the ONLY mutation that bumps SEQUENCE.
     */
    public function applyEdit(string $ics, string $body, DateTimeImmutable $editedAt): string
    {
        return $this->journal->applyEdit($ics, $body, $editedAt);
    }

    /**
     * Idempotent delete tombstone: body cleared, STATUS:CANCELLED, deletedAt
     * set once. Keeps thread integrity and stays visible in the changes feed.
     * Not an author body edit — SEQUENCE untouched.
     */
    public function applyTombstone(string $ics, DateTimeImmutable $deletedAt): string
    {
        return $this->journal->applyTombstone($ics, $deletedAt);
    }

    /**
     * Rewrite the full reaction state. Never touches SEQUENCE — the caller's
     * transaction is the serializer for concurrent toggles.
     *
     * @param  list<array{emoji: string, authors: list<string>}>  $reactions
     */
    public function applyReactions(string $ics, array $reactions): string
    {
        return $this->journal->applyReactions($ics, $reactions);
    }

    /**
     * @return array<string, mixed>
     */
    public function fromObject(CalendarObject $object, string $channelId): array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $message = $this->fromIcs($raw, (string) $object->uid);
        $message['channelId'] = $channelId;

        return $message;
    }

    /**
     * @return array<string, mixed>
     */
    public function fromIcs(string $ics, string $fallbackUid): array
    {
        [, $journal] = $this->journal->read($ics);

        $base = $this->journal->baseFields($journal, $fallbackUid);
        $tombstoned = $this->journal->isTombstoned($journal);
        $sequence = $this->journal->sequenceOf($journal);

        return [
            'id' => $base['id'],
            'authorId' => $base['authorId'],
            'body' => $tombstoned ? '' : $base['body'],
            'createdAt' => $base['createdAt'],
            'editedAt' => $sequence > 0 ? $this->journal->dateTimeValue($journal, 'LAST-MODIFIED') : null,
            'deletedAt' => $tombstoned
                ? (isset($journal->{'X-WGW-DELETED-AT'}) ? (string) $journal->{'X-WGW-DELETED-AT'} : null)
                : null,
            'parentId' => $base['parentId'],
            'reactions' => $this->journal->reactionsOf($journal),
            'mentions' => $this->journal->mentionsOf($journal),
            'sequence' => $sequence,
        ];
    }

    public function assertBodySize(string $body): void
    {
        $this->journal->assertBodySize($body);
    }
}
