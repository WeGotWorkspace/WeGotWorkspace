<?php

declare(strict_types=1);

namespace App\Services\Docs\Conversion;

use App\Models\CalendarObject;
use App\Services\Threads\ThreadEntryJournal;
use DateTimeImmutable;
use Sabre\VObject\Component\VJournal;

/**
 * Docs comment/suggestion thread <-> VJOURNAL mapping (Task #749; mirrors chat).
 *
 * VJOURNAL is a serialization format — these objects are DAV-hidden
 * (WgwCalendarBackend, kind docs_thread_pool):
 * - UID              = client ULID
 * - DESCRIPTION      = message body
 * - RELATED-TO       = thread root (replies only; chat single-level rule)
 * - X-WGW-AUTHOR     = author principal
 * - X-WGW-THREAD-KIND / X-WGW-DOC-PATH / X-WGW-ANCHOR-* / X-WGW-CHANGE-ID on roots
 * - X-WGW-RESOLVED   = comment roots
 * - X-WGW-ARCHIVED   = suggestion roots (not STATUS:CANCELLED)
 * - X-WGW-REACTIONS  = JSON on the root, rewritten in a transaction
 *
 * The shared entry properties live in ThreadEntryJournal (#2173 chunk A);
 * this class adds the Docs root fields and keeps Docs' property order.
 */
final class DocsThreadJournalConverter
{
    public const MAX_BODY_BYTES = ThreadEntryJournal::MAX_BODY_BYTES;

    public const KIND_COMMENT = 'comment';

    public const KIND_SUGGESTION = 'suggestion';

    private const LABEL = 'Thread';

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
        [$calendar, $journal] = $this->journal->create(
            (string) $message['id'],
            $createdAt,
            (string) $message['body'],
            (string) $message['author'],
        );
        $journal->add('X-WGW-DOC-PATH', (string) $message['docPath']);
        $journal->SEQUENCE = 0;

        if ($this->journal->addParent($journal, $message['parentId'] ?? null)) {
            return $calendar->serialize();
        }

        $kind = (string) ($message['kind'] ?? self::KIND_COMMENT);
        $journal->add('X-WGW-THREAD-KIND', $kind);
        $journal->add('X-WGW-ANCHOR-TEXT', (string) ($message['anchorText'] ?? ''));
        if (isset($message['anchorFrom'])) {
            $journal->add('X-WGW-ANCHOR-FROM', (string) $message['anchorFrom']);
        }
        if (isset($message['anchorTo'])) {
            $journal->add('X-WGW-ANCHOR-TO', (string) $message['anchorTo']);
        }
        if (isset($message['anchorOccurrence'])) {
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
        return $this->journal->applyReactions($ics, $reactions);
    }

    public function applyResolved(string $ics, bool $resolved): string
    {
        [$calendar, $journal] = $this->journal->read($ics);
        unset($journal->{'X-WGW-RESOLVED'});
        $journal->add('X-WGW-RESOLVED', $resolved ? 'TRUE' : 'FALSE');

        return $calendar->serialize();
    }

    public function applyArchived(string $ics, bool $archived): string
    {
        [$calendar, $journal] = $this->journal->read($ics);
        unset($journal->{'X-WGW-ARCHIVED'});
        $journal->add('X-WGW-ARCHIVED', $archived ? 'TRUE' : 'FALSE');

        return $calendar->serialize();
    }

    /**
     * @param  array{anchorText?: string|null, anchorFrom?: int|null, anchorTo?: int|null}  $anchors
     */
    public function applyAnchors(string $ics, array $anchors): string
    {
        [$calendar, $journal] = $this->journal->read($ics);
        if (array_key_exists('anchorText', $anchors) && is_string($anchors['anchorText'])) {
            unset($journal->{'X-WGW-ANCHOR-TEXT'});
            $journal->add('X-WGW-ANCHOR-TEXT', $anchors['anchorText']);
        }
        if (array_key_exists('anchorFrom', $anchors) && is_int($anchors['anchorFrom'])) {
            unset($journal->{'X-WGW-ANCHOR-FROM'});
            $journal->add('X-WGW-ANCHOR-FROM', (string) $anchors['anchorFrom']);
        }
        if (array_key_exists('anchorTo', $anchors) && is_int($anchors['anchorTo'])) {
            unset($journal->{'X-WGW-ANCHOR-TO'});
            $journal->add('X-WGW-ANCHOR-TO', (string) $anchors['anchorTo']);
        }

        return $calendar->serialize();
    }

    public function applyDocPath(string $ics, string $docPath): string
    {
        [$calendar, $journal] = $this->journal->read($ics);
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
        [, $journal] = $this->journal->read($ics);

        return [
            ...$this->journal->baseFields($journal, $fallbackUid),
            'kind' => isset($journal->{'X-WGW-THREAD-KIND'}) ? (string) $journal->{'X-WGW-THREAD-KIND'} : null,
            'docPath' => isset($journal->{'X-WGW-DOC-PATH'}) ? (string) $journal->{'X-WGW-DOC-PATH'} : '',
            'changeId' => isset($journal->{'X-WGW-CHANGE-ID'}) ? (string) $journal->{'X-WGW-CHANGE-ID'} : null,
            'anchorText' => isset($journal->{'X-WGW-ANCHOR-TEXT'}) ? (string) $journal->{'X-WGW-ANCHOR-TEXT'} : '',
            'anchorFrom' => $this->optionalInt($journal, 'X-WGW-ANCHOR-FROM'),
            'anchorTo' => $this->optionalInt($journal, 'X-WGW-ANCHOR-TO'),
            'anchorOccurrence' => $this->optionalInt($journal, 'X-WGW-ANCHOR-OCCURRENCE'),
            'resolved' => $this->flag($journal, 'X-WGW-RESOLVED'),
            'archived' => $this->flag($journal, 'X-WGW-ARCHIVED'),
            'reactions' => $this->journal->reactionsOf($journal),
        ];
    }

    public function assertBodySize(string $body): void
    {
        $this->journal->assertBodySize($body);
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
}
