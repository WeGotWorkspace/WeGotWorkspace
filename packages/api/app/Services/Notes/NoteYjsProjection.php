<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Notes\Conversion\NoteJournalConverter;

/**
 * The journal ETag and a hash of SUMMARY + DESCRIPTION, stored beside the Yjs
 * bytes. A later read compares them. Tags, a move, and archive change the
 * journal ETag and leave this hash alone.
 */
final class NoteYjsProjection
{
    public function __construct(
        private readonly NoteJournalConverter $converter,
    ) {}

    public static function hashContent(string $body, ?string $title): string
    {
        return hash('sha1', $body."\0".($title ?? ''));
    }

    public function store(CalendarObject $object, string $bytes): void
    {
        $parsed = $this->parsed($object);
        NoteYjsState::query()->updateOrCreate(
            ['calendar_object_id' => (int) $object->id],
            [
                'note_uid' => (string) $object->uid,
                'state' => $bytes,
                'object_etag' => $this->journalEtag($object),
                'content_etag' => self::hashContent($parsed['body'], $parsed['title']),
            ],
        );
    }

    /**
     * True when the journal moved on and SUMMARY or DESCRIPTION is not the
     * text this Yjs state was written from. A matching hash is a metadata
     * change: the state is still an ancestor of the note.
     */
    public function isExternalContentWrite(NoteYjsState $row, CalendarObject $object): bool
    {
        if ($this->sameEtag((string) $row->object_etag, $this->journalEtag($object))) {
            return false;
        }

        $stored = $row->content_etag;
        if (! is_string($stored) || $stored === '') {
            return true;
        }

        $parsed = $this->parsed($object);

        return $stored !== self::hashContent($parsed['body'], $parsed['title']);
    }

    public function journalEtag(CalendarObject $object): string
    {
        return OptimisticConcurrency::formatEtag((string) $object->etag) ?? (string) $object->etag;
    }

    /**
     * @return array{body: string, title: string|null}
     */
    private function parsed(CalendarObject $object): array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $note = $this->converter->fromIcs($raw, (string) $object->uid);
        $title = $note['title'] ?? null;

        return [
            'body' => is_string($note['body'] ?? null) ? $note['body'] : '',
            'title' => is_string($title) ? $title : null,
        ];
    }

    private function sameEtag(string $stored, string $current): bool
    {
        $left = OptimisticConcurrency::formatEtag($stored) ?? '';
        $right = OptimisticConcurrency::formatEtag($current) ?? '';

        return $left !== '' && $left === $right;
    }
}
