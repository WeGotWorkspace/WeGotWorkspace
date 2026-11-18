<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Exceptions\ApiHttpException;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VJournal;
use Sabre\VObject\Property\ICalendar\DateTime as IcsDateTime;
use Sabre\VObject\Reader;

/**
 * The shared core of a thread entry stored as one VJOURNAL (#2173 chunk A,
 * docs/architecture/threads.md rule 1). Chat messages and Docs comments wrap
 * it with their own properties; task threads will use it as is.
 *
 * - UID           = client ULID, uppercase
 * - DTSTAMP       = server-assigned created time, never touched again
 * - DESCRIPTION   = body (cleared on tombstones), at most MAX_BODY_BYTES
 * - X-WGW-AUTHOR  = author principal username
 * - RELATED-TO    = root entry of a reply
 * - X-WGW-MENTIONS  = JSON [{id, displayName}]
 * - X-WGW-REACTIONS = JSON [{emoji, authors}], an OR-set rewritten in a transaction
 * - SEQUENCE / LAST-MODIFIED = author body edits only
 * - STATUS:CANCELLED + X-WGW-DELETED-AT = delete tombstone
 *
 * The labels only shape error messages, so each domain keeps the wording its
 * API already returns ("Message id must be a ULID." / "Thread id …").
 */
final class ThreadEntryJournal
{
    public const MAX_BODY_BYTES = 65_536;

    private const ULID_PATTERN = '/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/';

    /**
     * @param  string  $label  capitalised noun for id errors and "is not a VJOURNAL" ("Message", "Thread")
     */
    public function __construct(private readonly string $label = 'Entry') {}

    public static function normalizeUlid(string $id, string $label = 'Entry'): string
    {
        $ulid = strtoupper(trim($id));
        if (preg_match(self::ULID_PATTERN, $ulid) !== 1) {
            throw new ApiHttpException(400, $label.' id must be a ULID.', 'invalidProperties', ['id']);
        }

        return $ulid;
    }

    public function assertBodySize(string $body): void
    {
        if (strlen($body) > self::MAX_BODY_BYTES) {
            throw new ApiHttpException(413, 'Message body exceeds the 64 KiB limit.', 'payload_too_large');
        }
    }

    /**
     * A new entry with UID, DTSTAMP, DESCRIPTION and X-WGW-AUTHOR, in that
     * order. The caller adds the rest in its own order and serializes.
     *
     * @return array{0: VCalendar, 1: VJournal}
     */
    public function create(string $id, DateTimeImmutable $createdAt, string $body, string $author): array
    {
        $this->assertBodySize($body);

        $calendar = new VCalendar;
        $journal = $calendar->add('VJOURNAL', [
            'UID' => self::normalizeUlid($id, $this->label),
            'DTSTAMP' => $createdAt->setTimezone(new DateTimeZone('UTC')),
        ]);
        if (! $journal instanceof VJournal) {
            throw new \LogicException('Expected a VJOURNAL component.');
        }
        $journal->DESCRIPTION = $body;
        $journal->add('X-WGW-AUTHOR', $author);

        return [$calendar, $journal];
    }

    public function addParent(VJournal $journal, ?string $parentId): bool
    {
        if (! is_string($parentId) || $parentId === '') {
            return false;
        }
        $journal->add('RELATED-TO', self::normalizeUlid($parentId, $this->label));

        return true;
    }

    /**
     * @param  list<array{id: string, displayName?: string}>  $mentions
     */
    public function addMentions(VJournal $journal, array $mentions): void
    {
        $normalized = [];
        foreach ($mentions as $mention) {
            $id = strtolower(trim($mention['id']));
            if ($id === '') {
                continue;
            }
            $display = isset($mention['displayName']) ? trim($mention['displayName']) : $id;
            $normalized[] = ['id' => $id, 'displayName' => $display !== '' ? $display : $id];
        }
        if ($normalized !== []) {
            $journal->add('X-WGW-MENTIONS', json_encode($normalized, JSON_UNESCAPED_UNICODE));
        }
    }

    /**
     * Author body edit: the only change that bumps SEQUENCE.
     */
    public function applyEdit(string $ics, string $body, DateTimeImmutable $editedAt): string
    {
        $this->assertBodySize($body);
        [$calendar, $journal] = $this->read($ics);

        $journal->DESCRIPTION = $body;
        $journal->SEQUENCE = $this->sequenceOf($journal) + 1;
        unset($journal->{'LAST-MODIFIED'});
        $journal->add('LAST-MODIFIED', $editedAt->setTimezone(new DateTimeZone('UTC')));

        return $calendar->serialize();
    }

    /**
     * Idempotent delete tombstone: body cleared, STATUS:CANCELLED, deletedAt
     * set once. SEQUENCE untouched.
     */
    public function applyTombstone(string $ics, DateTimeImmutable $deletedAt): string
    {
        [$calendar, $journal] = $this->read($ics);

        if ($this->isTombstoned($journal)) {
            return $ics;
        }

        $journal->STATUS = 'CANCELLED';
        unset($journal->DESCRIPTION);
        $journal->add('X-WGW-DELETED-AT', self::formatUtc($deletedAt));

        return $calendar->serialize();
    }

    /**
     * Rewrite the full reaction state. Never touches SEQUENCE; the caller's
     * transaction serializes concurrent toggles.
     *
     * @param  list<array{emoji: string, authors: list<string>}>  $reactions
     */
    public function applyReactions(string $ics, array $reactions): string
    {
        [$calendar, $journal] = $this->read($ics);

        unset($journal->{'X-WGW-REACTIONS'});
        if ($reactions !== []) {
            $journal->add('X-WGW-REACTIONS', json_encode($reactions, JSON_UNESCAPED_UNICODE));
        }

        return $calendar->serialize();
    }

    /**
     * @return array{0: VCalendar, 1: VJournal}
     */
    public function read(string $ics): array
    {
        $noun = strtolower($this->label);
        try {
            $calendar = Reader::read($ics);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid '.$noun.' payload.', 'bad_request');
        }
        if (! $calendar instanceof VCalendar) {
            throw new ApiHttpException(400, 'Invalid '.$noun.' payload.', 'bad_request');
        }
        foreach ($calendar->select('VJOURNAL') as $component) {
            if ($component instanceof VJournal) {
                return [$calendar, $component];
            }
        }

        throw new ApiHttpException(400, $this->label.' is not a VJOURNAL.', 'bad_request');
    }

    /**
     * The fields every entry has, read back. Domains add their own keys.
     *
     * @return array{id: string, authorId: string, body: string, createdAt: string, parentId: string|null}
     */
    public function baseFields(VJournal $journal, string $fallbackUid): array
    {
        $uid = isset($journal->UID) ? (string) $journal->UID : $fallbackUid;

        return [
            'id' => $uid !== '' ? $uid : $fallbackUid,
            'authorId' => isset($journal->{'X-WGW-AUTHOR'}) ? (string) $journal->{'X-WGW-AUTHOR'} : '',
            'body' => isset($journal->DESCRIPTION) ? (string) $journal->DESCRIPTION : '',
            'createdAt' => $this->dateTimeValue($journal, 'DTSTAMP') ?? '',
            'parentId' => isset($journal->{'RELATED-TO'}) ? ((string) $journal->{'RELATED-TO'} ?: null) : null,
        ];
    }

    /**
     * @return list<array{emoji: string, authors: list<string>}>
     */
    public function reactionsOf(VJournal $journal): array
    {
        $reactions = [];
        if (! isset($journal->{'X-WGW-REACTIONS'})) {
            return $reactions;
        }
        $decoded = json_decode((string) $journal->{'X-WGW-REACTIONS'}, true);
        if (! is_array($decoded)) {
            return $reactions;
        }
        foreach ($decoded as $entry) {
            if (! is_array($entry) || ! is_string($entry['emoji'] ?? null) || ! is_array($entry['authors'] ?? null)) {
                continue;
            }
            $reactions[] = [
                'emoji' => $entry['emoji'],
                'authors' => array_values(array_map('strval', $entry['authors'])),
            ];
        }

        return $reactions;
    }

    /**
     * @return list<array{id: string, displayName: string}>
     */
    public function mentionsOf(VJournal $journal): array
    {
        $mentions = [];
        if (! isset($journal->{'X-WGW-MENTIONS'})) {
            return $mentions;
        }
        $decoded = json_decode((string) $journal->{'X-WGW-MENTIONS'}, true);
        if (! is_array($decoded)) {
            return $mentions;
        }
        foreach ($decoded as $entry) {
            if (! is_array($entry) || ! is_string($entry['id'] ?? null)) {
                continue;
            }
            $id = strtolower(trim($entry['id']));
            if ($id === '') {
                continue;
            }
            $display = isset($entry['displayName']) && is_string($entry['displayName'])
                ? trim($entry['displayName'])
                : $id;
            $mentions[] = ['id' => $id, 'displayName' => $display !== '' ? $display : $id];
        }

        return $mentions;
    }

    public function isTombstoned(VJournal $journal): bool
    {
        return isset($journal->STATUS) && strtoupper((string) $journal->STATUS) === 'CANCELLED';
    }

    public function sequenceOf(VJournal $journal): int
    {
        return isset($journal->SEQUENCE) ? (int) ((string) $journal->SEQUENCE) : 0;
    }

    public function dateTimeValue(VJournal $journal, string $property): ?string
    {
        if (! isset($journal->{$property})) {
            return null;
        }
        $prop = $journal->{$property};
        if ($prop instanceof IcsDateTime) {
            $dateTimes = $prop->getDateTimes();
            if ($dateTimes !== []) {
                return self::formatUtc($dateTimes[0]);
            }
        }

        return null;
    }

    public static function formatUtc(DateTimeInterface $dateTime): string
    {
        return DateTimeImmutable::createFromInterface($dateTime)
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s\Z');
    }
}
