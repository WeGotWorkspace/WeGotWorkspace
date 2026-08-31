<?php

declare(strict_types=1);

namespace App\Services\Notes\Conversion;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarObject;
use App\Services\VObject\ICalendarDateTime;
use DateTimeImmutable;
use DateTimeZone;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VJournal;
use Sabre\VObject\Property;
use Sabre\VObject\Reader;

final class NoteJournalConverter
{
    public const MAX_MARKDOWN_BYTES = 2_097_152;

    /**
     * @param  array<string, mixed>  $note
     */
    public function toIcs(array $note): string
    {
        $body = is_string($note['body'] ?? null) ? $note['body'] : '';
        $this->assertBodySize($body);

        $calendar = new VCalendar;
        $journal = $calendar->add('VJOURNAL', [
            'UID' => (string) $note['id'],
            'DTSTAMP' => (new DateTimeImmutable('now', new DateTimeZone('UTC'))),
        ]);
        $title = $note['title'] ?? null;
        if (is_string($title)) {
            $journal->SUMMARY = $title;
        }
        if ($body !== '') {
            $journal->DESCRIPTION = $body;
        }
        $categories = $note['categories'] ?? [];
        if (is_array($categories) && $categories !== []) {
            $journal->CATEGORIES = array_values(array_map('strval', $categories));
        }
        $status = $note['status'] ?? null;
        if ($status === 'CANCELLED' || $status === 'FINAL') {
            $journal->STATUS = $status;
        }

        return $calendar->serialize();
    }

    /**
     * Read-modify-write: apply field patches without clobbering unspecified DESCRIPTION.
     *
     * @param  array<string, mixed>  $patch
     */
    public function mergeIntoIcs(string $ics, array $patch): string
    {
        if (array_key_exists('body', $patch) && is_string($patch['body'])) {
            $this->assertBodySize($patch['body']);
        }

        try {
            $calendar = Reader::read($ics);
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Invalid journal payload.', 'bad_request');
        }
        if (! $calendar instanceof VCalendar) {
            throw new ApiHttpException(400, 'Invalid journal payload.', 'bad_request');
        }

        $journal = null;
        foreach ($calendar->getComponents('VJOURNAL') as $component) {
            if ($component instanceof VJournal) {
                $journal = $component;
                break;
            }
        }
        if (! $journal instanceof VJournal) {
            throw new ApiHttpException(400, 'Note is not a VJOURNAL.', 'bad_request');
        }

        if (array_key_exists('title', $patch)) {
            $title = $patch['title'];
            if (is_string($title)) {
                $journal->SUMMARY = $title;
            } else {
                unset($journal->SUMMARY);
            }
        }
        if (array_key_exists('body', $patch)) {
            $body = is_string($patch['body']) ? $patch['body'] : '';
            if ($body !== '') {
                $journal->DESCRIPTION = $body;
            } else {
                unset($journal->DESCRIPTION);
            }
        }
        if (array_key_exists('categories', $patch) && is_array($patch['categories'])) {
            unset($journal->CATEGORIES);
            if ($patch['categories'] !== []) {
                $journal->CATEGORIES = array_values(array_map('strval', $patch['categories']));
            }
        }
        if (array_key_exists('status', $patch)) {
            $status = $patch['status'];
            if ($status === 'CANCELLED' || $status === 'FINAL') {
                $journal->STATUS = $status;
            } else {
                unset($journal->STATUS);
            }
        }

        return $calendar->serialize();
    }

    /**
     * @return array<string, mixed>
     */
    public function fromObject(CalendarObject $object, string $notebookId, bool $starred = false): array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $note = $this->fromIcs($raw, (string) $object->uid);
        $note['notebookId'] = $notebookId;
        $note['etag'] = OptimisticConcurrency::formatEtag((string) $object->etag) ?? (string) $object->etag;
        $note['starred'] = $starred;
        if (! isset($note['updatedAt']) || ! is_string($note['updatedAt']) || $note['updatedAt'] === '') {
            $lastModified = (int) ($object->lastmodified ?? 0);
            if ($lastModified > 0) {
                $note['updatedAt'] = gmdate('Y-m-d\TH:i:s\Z', $lastModified);
            }
        }

        return $note;
    }

    /**
     * @return array<string, mixed>
     */
    public function fromIcs(string $ics, string $fallbackUid): array
    {
        try {
            $calendar = Reader::read($ics);
        } catch (\Throwable) {
            return [
                'id' => $fallbackUid,
                'title' => null,
                'body' => '',
                'categories' => [],
                'status' => null,
            ];
        }

        $journal = null;
        if ($calendar instanceof VCalendar) {
            foreach ($calendar->getComponents('VJOURNAL') as $component) {
                if ($component instanceof VJournal) {
                    $journal = $component;
                    break;
                }
            }
        }

        if (! $journal instanceof VJournal) {
            return [
                'id' => $fallbackUid,
                'title' => null,
                'body' => '',
                'categories' => [],
                'status' => null,
            ];
        }

        $uid = isset($journal->UID) ? (string) $journal->UID : $fallbackUid;
        $title = isset($journal->SUMMARY) ? (string) $journal->SUMMARY : null;
        $body = isset($journal->DESCRIPTION) ? (string) $journal->DESCRIPTION : '';
        $categories = [];
        if (isset($journal->CATEGORIES)) {
            foreach ($journal->CATEGORIES as $category) {
                $categories[] = (string) $category;
            }
        }
        $status = isset($journal->STATUS) ? strtoupper((string) $journal->STATUS) : null;
        if ($status !== 'CANCELLED' && $status !== 'FINAL') {
            $status = null;
        }

        $note = [
            'id' => $uid !== '' ? $uid : $fallbackUid,
            'title' => $title,
            'body' => $body,
            'categories' => $categories,
            'status' => $status,
        ];
        $updatedAt = $this->journalUpdatedAt($journal);
        if ($updatedAt !== null) {
            $note['updatedAt'] = $updatedAt;
        }

        return $note;
    }

    /**
     * LAST-MODIFIED, then DTSTAMP — same ICS pair Tasks maps to `updated`.
     */
    private function journalUpdatedAt(VJournal $journal): ?string
    {
        foreach (['LAST-MODIFIED', 'DTSTAMP'] as $name) {
            if (! isset($journal->{$name})) {
                continue;
            }
            $property = $journal->{$name};
            if (! $property instanceof Property) {
                continue;
            }
            $value = ICalendarDateTime::fromProperty($property)['value'];
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    public function assertBodySize(string $body): void
    {
        if (strlen($body) > self::MAX_MARKDOWN_BYTES) {
            throw new ApiHttpException(413, 'Note body exceeds the 2 MiB markdown limit.', 'payload_too_large');
        }
    }
}
