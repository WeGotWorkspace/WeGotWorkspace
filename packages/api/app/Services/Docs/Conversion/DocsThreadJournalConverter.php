<?php

declare(strict_types=1);

namespace App\Services\Docs\Conversion;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VJournal;
use Sabre\VObject\Reader;

/**
 * Docs comment/suggestion thread <-> VJOURNAL mapping (Task #749; mirrors chat).
 *
 * VJOURNAL is a serialization format — these objects are DAV-hidden
 * (ChatHiddenCalendarBackend + docs-threads prefix):
 * - UID              = client ULID
 * - DESCRIPTION      = message body
 * - RELATED-TO       = thread root (replies only; chat single-level rule)
 * - X-WGW-AUTHOR     = author principal
 * - X-WGW-THREAD-KIND / X-WGW-DOC-PATH / X-WGW-ANCHOR-* / X-WGW-CHANGE-ID on roots
 * - X-WGW-RESOLVED   = comment roots
 * - X-WGW-ARCHIVED   = suggestion roots (not STATUS:CANCELLED)
 * - X-WGW-REACTIONS  = JSON on the root, rewritten in a transaction
 */
final class DocsThreadJournalConverter
{
    public const MAX_BODY_BYTES = 65_536;

    public const KIND_COMMENT = 'comment';

    public const KIND_SUGGESTION = 'suggestion';

    private const ULID_PATTERN = '/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/';

    public static function normalizeUlid(string $id): string
    {
        $ulid = strtoupper(trim($id));
        if (preg_match(self::ULID_PATTERN, $ulid) !== 1) {
            throw new ApiHttpException(400, 'Thread id must be a ULID.', 'invalidProperties', ['id']);
        }

        return $ulid;
    }

    /**
     * @param  array{
     *   id: string,
     *   body: string,
     *   author: string,
     *   docPath: string,
     *   kind?: string,
     *   parentId?: string|null,
     *   changeId?: string|null,
     *   anchorText?: string,
     *   anchorFrom?: int|null,
     *   anchorTo?: int|null,
     *   anchorOccurrence?: int|null
     * }  $message
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
        $journal->add('X-WGW-DOC-PATH', (string) $message['docPath']);
        $journal->SEQUENCE = 0;

        $parentId = $message['parentId'] ?? null;
        if (is_string($parentId) && $parentId !== '') {
            $journal->add('RELATED-TO', self::normalizeUlid($parentId));

            return $calendar->serialize();
        }

        $kind = (string) ($message['kind'] ?? self::KIND_COMMENT);
        $journal->add('X-WGW-THREAD-KIND', $kind);
        $journal->add('X-WGW-ANCHOR-TEXT', (string) ($message['anchorText'] ?? ''));
        if (isset($message['anchorFrom']) && is_int($message['anchorFrom'])) {
            $journal->add('X-WGW-ANCHOR-FROM', (string) $message['anchorFrom']);
        }
        if (isset($message['anchorTo']) && is_int($message['anchorTo'])) {
            $journal->add('X-WGW-ANCHOR-TO', (string) $message['anchorTo']);
        }
        if (isset($message['anchorOccurrence']) && is_int($message['anchorOccurrence'])) {
            $journal->add('X-WGW-ANCHOR-OCCURRENCE', (string) $message['anchorOccurrence']);
        }
        $changeId = $message['changeId'] ?? null;
        if (is_string($changeId) && $changeId !== '') {
            $journal->add('X-WGW-CHANGE-ID', $changeId);
        }
        $journal->add('X-WGW-RESOLVED', 'FALSE');
        $journal->add('X-WGW-ARCHIVED', 'FALSE');

        return $calendar->serialize();
    }

    /**
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

    public function applyResolved(string $ics, bool $resolved): string
    {
        [$calendar, $journal] = $this->readJournal($ics);
        unset($journal->{'X-WGW-RESOLVED'});
        $journal->add('X-WGW-RESOLVED', $resolved ? 'TRUE' : 'FALSE');

        return $calendar->serialize();
    }

    public function applyArchived(string $ics, bool $archived): string
    {
        [$calendar, $journal] = $this->readJournal($ics);
        unset($journal->{'X-WGW-ARCHIVED'});
        $journal->add('X-WGW-ARCHIVED', $archived ? 'TRUE' : 'FALSE');

        return $calendar->serialize();
    }

    public function applyDocPath(string $ics, string $docPath): string
    {
        [$calendar, $journal] = $this->readJournal($ics);
        unset($journal->{'X-WGW-DOC-PATH'});
        $journal->add('X-WGW-DOC-PATH', $docPath);

        return $calendar->serialize();
    }

    /**
     * @return array<string, mixed>
     */
    public function fromObject(CalendarObject $object): array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;

        return $this->fromIcs($raw, (string) $object->uid);
    }

    /**
     * @return array<string, mixed>
     */
    public function fromIcs(string $ics, string $fallbackUid): array
    {
        [, $journal] = $this->readJournal($ics);

        $uid = isset($journal->UID) ? (string) $journal->UID : $fallbackUid;
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
            'body' => isset($journal->DESCRIPTION) ? (string) $journal->DESCRIPTION : '',
            'createdAt' => $this->dateTimeValue($journal, 'DTSTAMP') ?? '',
            'parentId' => isset($journal->{'RELATED-TO'}) ? ((string) $journal->{'RELATED-TO'} ?: null) : null,
            'kind' => isset($journal->{'X-WGW-THREAD-KIND'}) ? (string) $journal->{'X-WGW-THREAD-KIND'} : null,
            'docPath' => isset($journal->{'X-WGW-DOC-PATH'}) ? (string) $journal->{'X-WGW-DOC-PATH'} : '',
            'changeId' => isset($journal->{'X-WGW-CHANGE-ID'}) ? (string) $journal->{'X-WGW-CHANGE-ID'} : null,
            'anchorText' => isset($journal->{'X-WGW-ANCHOR-TEXT'}) ? (string) $journal->{'X-WGW-ANCHOR-TEXT'} : '',
            'anchorFrom' => $this->optionalInt($journal, 'X-WGW-ANCHOR-FROM'),
            'anchorTo' => $this->optionalInt($journal, 'X-WGW-ANCHOR-TO'),
            'anchorOccurrence' => $this->optionalInt($journal, 'X-WGW-ANCHOR-OCCURRENCE'),
            'resolved' => $this->flag($journal, 'X-WGW-RESOLVED'),
            'archived' => $this->flag($journal, 'X-WGW-ARCHIVED'),
            'reactions' => $reactions,
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
            throw new ApiHttpException(400, 'Invalid thread payload.', 'bad_request');
        }
        if (! $calendar instanceof VCalendar) {
            throw new ApiHttpException(400, 'Invalid thread payload.', 'bad_request');
        }
        foreach ($calendar->getComponents('VJOURNAL') as $component) {
            if ($component instanceof VJournal) {
                return [$calendar, $component];
            }
        }

        throw new ApiHttpException(400, 'Thread is not a VJOURNAL.', 'bad_request');
    }

    private function flag(VJournal $journal, string $property): bool
    {
        if (! isset($journal->{$property})) {
            return false;
        }

        return strtoupper((string) $journal->{$property}) === 'TRUE';
    }

    private function optionalInt(VJournal $journal, string $property): ?int
    {
        if (! isset($journal->{$property})) {
            return null;
        }
        $raw = trim((string) $journal->{$property});
        if ($raw === '' || ! is_numeric($raw)) {
            return null;
        }

        return (int) $raw;
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
                return DateTimeImmutable::createFromInterface($dateTime)
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format('Y-m-d\TH:i:s\Z');
            }
        }

        return null;
    }
}
