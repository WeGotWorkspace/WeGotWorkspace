<?php

declare(strict_types=1);

namespace App\Services\Chat\Conversion;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VJournal;
use Sabre\VObject\Reader;

/**
 * Chat message <-> VJOURNAL mapping (Epic #701; mirrors NoteJournalConverter).
 *
 * VJOURNAL is a serialization format here, not a semantic fit — these objects
 * are never DAV-visible (ChatHiddenCalendarBackend):
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
 */
final class ChatMessageJournalConverter
{
    public const MAX_BODY_BYTES = 65_536;

    private const ULID_PATTERN = '/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/';

    public static function normalizeUlid(string $id): string
    {
        $ulid = strtoupper(trim($id));
        if (preg_match(self::ULID_PATTERN, $ulid) !== 1) {
            throw new ApiHttpException(400, 'Message id must be a ULID.', 'invalidProperties', ['id']);
        }

        return $ulid;
    }

    /**
     * @param  array{id: string, body: string, author: string, parentId?: string|null}  $message
     */
    public function toIcs(array $message, DateTimeImmutable $createdAt): string
    {
        $body = (string) $message['body'];
        $this->assertBodySize($body);

        $calendar = new VCalendar;
        $journal = $calendar->add('VJOURNAL', [
            'UID' => self::normalizeUlid((string) $message['id']),
            'DTSTAMP' => $createdAt->setTimezone(new DateTimeZone('UTC')),
        ]);
        $journal->DESCRIPTION = $body;
        $journal->add('X-WGW-AUTHOR', (string) $message['author']);
        $parentId = $message['parentId'] ?? null;
        if (is_string($parentId) && $parentId !== '') {
            $journal->add('RELATED-TO', self::normalizeUlid($parentId));
        }
        $journal->SEQUENCE = 0;

        return $calendar->serialize();
    }

    /**
     * Author body edit: the ONLY mutation that bumps SEQUENCE.
     */
    public function applyEdit(string $ics, string $body, DateTimeImmutable $editedAt): string
    {
        $this->assertBodySize($body);
        [$calendar, $journal] = $this->readJournal($ics);

        $journal->DESCRIPTION = $body;
        $journal->SEQUENCE = $this->sequenceOf($journal) + 1;
        unset($journal->{'LAST-MODIFIED'});
        $journal->add('LAST-MODIFIED', $editedAt->setTimezone(new DateTimeZone('UTC')));

        return $calendar->serialize();
    }

    /**
     * Idempotent delete tombstone: body cleared, STATUS:CANCELLED, deletedAt
     * set once. Keeps thread integrity and stays visible in the changes feed.
     * Not an author body edit — SEQUENCE untouched.
     */
    public function applyTombstone(string $ics, DateTimeImmutable $deletedAt): string
    {
        [$calendar, $journal] = $this->readJournal($ics);

        if ($this->isTombstoned($journal)) {
            return $ics;
        }

        $journal->STATUS = 'CANCELLED';
        unset($journal->DESCRIPTION);
        $journal->add('X-WGW-DELETED-AT', $this->formatUtc($deletedAt));

        return $calendar->serialize();
    }

    /**
     * Rewrite the full reaction state. Never touches SEQUENCE — the caller's
     * transaction is the serializer for concurrent toggles.
     *
     * @param  list<array{emoji: string, authors: list<string>}>  $reactions
     */
    public function applyReactions(string $ics, array $reactions): string
    {
        [$calendar, $journal] = $this->readJournal($ics);

        unset($journal->{'X-WGW-REACTIONS'});
        if ($reactions !== []) {
            $journal->add('X-WGW-REACTIONS', json_encode(array_values($reactions), JSON_UNESCAPED_UNICODE));
        }

        return $calendar->serialize();
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
        [, $journal] = $this->readJournal($ics);

        $uid = isset($journal->UID) ? (string) $journal->UID : $fallbackUid;
        $tombstoned = $this->isTombstoned($journal);
        $sequence = $this->sequenceOf($journal);

        $reactions = [];
        if (isset($journal->{'X-WGW-REACTIONS'})) {
            $decoded = json_decode((string) $journal->{'X-WGW-REACTIONS'}, true);
            if (is_array($decoded)) {
                foreach ($decoded as $entry) {
                    if (! is_array($entry) || ! is_string($entry['emoji'] ?? null) || ! is_array($entry['authors'] ?? null)) {
                        continue;
                    }
                    $reactions[] = [
                        'emoji' => $entry['emoji'],
                        'authors' => array_values(array_map('strval', $entry['authors'])),
                    ];
                }
            }
        }

        return [
            'id' => $uid !== '' ? $uid : $fallbackUid,
            'authorId' => isset($journal->{'X-WGW-AUTHOR'}) ? (string) $journal->{'X-WGW-AUTHOR'} : '',
            'body' => $tombstoned ? '' : (isset($journal->DESCRIPTION) ? (string) $journal->DESCRIPTION : ''),
            'createdAt' => $this->dateTimeValue($journal, 'DTSTAMP') ?? '',
            'editedAt' => $sequence > 0 ? $this->dateTimeValue($journal, 'LAST-MODIFIED') : null,
            'deletedAt' => $tombstoned
                ? (isset($journal->{'X-WGW-DELETED-AT'}) ? (string) $journal->{'X-WGW-DELETED-AT'} : null)
                : null,
            'parentId' => isset($journal->{'RELATED-TO'}) ? ((string) $journal->{'RELATED-TO'} ?: null) : null,
            'reactions' => $reactions,
            'sequence' => $sequence,
        ];
    }

    public function assertBodySize(string $body): void
    {
        if (strlen($body) > self::MAX_BODY_BYTES) {
            throw new ApiHttpException(413, 'Message body exceeds the 64 KiB limit.', 'payload_too_large');
        }
    }

    /**
     * @return array{0: VCalendar, 1: VJournal}
     */
    private function readJournal(string $ics): array
    {
        try {
            $calendar = Reader::read($ics);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid message payload.', 'bad_request');
        }
        if (! $calendar instanceof VCalendar) {
            throw new ApiHttpException(400, 'Invalid message payload.', 'bad_request');
        }
        foreach ($calendar->getComponents('VJOURNAL') as $component) {
            if ($component instanceof VJournal) {
                return [$calendar, $component];
            }
        }

        throw new ApiHttpException(400, 'Message is not a VJOURNAL.', 'bad_request');
    }

    private function isTombstoned(VJournal $journal): bool
    {
        return isset($journal->STATUS) && strtoupper((string) $journal->STATUS) === 'CANCELLED';
    }

    private function sequenceOf(VJournal $journal): int
    {
        return isset($journal->SEQUENCE) ? (int) ((string) $journal->SEQUENCE) : 0;
    }

    private function dateTimeValue(VJournal $journal, string $property): ?string
    {
        if (! isset($journal->{$property})) {
            return null;
        }
        $prop = $journal->{$property};
        if (method_exists($prop, 'getDateTime')) {
            $dateTime = $prop->getDateTime();
            if ($dateTime instanceof DateTimeInterface) {
                return $this->formatUtc($dateTime);
            }
        }

        return null;
    }

    private function formatUtc(DateTimeInterface $dateTime): string
    {
        return DateTimeImmutable::createFromInterface($dateTime)
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s\Z');
    }
}
