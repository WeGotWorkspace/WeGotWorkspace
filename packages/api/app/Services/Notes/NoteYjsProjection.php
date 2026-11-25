<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Collab\CollabTextState;

/**
 * Notes' view of the shared live-text core: the journal ETag and a hash of
 * DESCRIPTION + SUMMARY beside the Yjs bytes. Tags, a move, and archive
 * change the journal ETag and leave this hash alone.
 */
final class NoteYjsProjection
{
    public function __construct(
        private readonly CollabTextState $core,
        private readonly NoteTextFields $fields,
    ) {}

    public static function hashContent(string $body, ?string $title): string
    {
        return CollabTextState::hashFields([$body, $title ?? '']);
    }

    public function store(CalendarObject $object, string $bytes): string
    {
        return $this->core->store($this->fields, $object, $bytes);
    }

    /** True when the journal moved on and its text is not the state's. */
    public function isExternalContentWrite(NoteYjsState $row, CalendarObject $object): bool
    {
        return $this->core->isExternalContentWrite($this->fields, $row, $object);
    }

    /** The content tag of the text the stored state was written from. */
    public function stateContentTag(NoteYjsState $row): ?string
    {
        return $this->core->stateContentTag($row);
    }

    /** The tag of the note's text. A tag, move, or archive does not change it. */
    public function contentEtag(CalendarObject $object): string
    {
        return $this->core->contentTag($this->fields, $object);
    }

    /**
     * {@see contentEtag()} from a note already mapped by NoteJournalConverter: the
     * same two fields (body, title) that NoteTextFields reads, without a second parse.
     *
     * @param  array<string, mixed>  $note
     */
    public function contentEtagOfNote(array $note): string
    {
        $title = $note['title'] ?? null;

        return CollabTextState::contentTagOf([
            is_string($note['body'] ?? null) ? $note['body'] : '',
            is_string($title) ? $title : '',
        ]);
    }

    /** Does `X-Wgw-External-Write` name the note's current text (never `*`). */
    public function namesContent(string $header, CalendarObject $object): bool
    {
        return $this->core->namesContent($this->fields, $header, $object);
    }

    public function journalEtag(CalendarObject $object): string
    {
        return $this->core->objectEtag($object);
    }
}
