<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Collab\CollabTextFields;
use App\Services\Notes\Conversion\NoteJournalConverter;

/**
 * Notes' live text: DESCRIPTION then SUMMARY of the journal, stored in
 * `note_yjs_state`. The order keeps every stored Notes content tag valid.
 */
final class NoteTextFields implements CollabTextFields
{
    public function __construct(
        private readonly NoteJournalConverter $converter,
    ) {}

    #[\Override]
    public function textFields(CalendarObject $object): array
    {
        $parsed = $this->parsed($object);

        return [$parsed['body'], $parsed['title'] ?? ''];
    }

    #[\Override]
    public function findState(CalendarObject $object): ?NoteYjsState
    {
        return NoteYjsState::query()
            ->where('calendar_object_id', (int) $object->id)
            ->first();
    }

    #[\Override]
    public function storeState(CalendarObject $object, array $columns): void
    {
        NoteYjsState::query()->updateOrCreate(
            ['calendar_object_id' => (int) $object->id],
            ['note_uid' => (string) $object->uid] + $columns,
        );
    }

    /** Notes stores what the 5 MiB request limit lets through, as before. */
    #[\Override]
    public function maxStateBytes(): ?int
    {
        return null;
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
}
