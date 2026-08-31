<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\JmapNoteState;

/**
 * Survives notebook purge so Note/changes can expand destroyed ids
 * (same role as {@see \App\Services\Calendars\JmapCalendarEventStateService}).
 */
final class JmapNoteStateService
{
    public function remember(string $username, string $noteId, string $notebookUri, ?string $objectUri = null): void
    {
        if ($username === '' || $noteId === '' || $notebookUri === '') {
            return;
        }

        $row = JmapNoteState::query()
            ->where('username', $username)
            ->where('note_id', $noteId)
            ->first();

        if ($row === null) {
            JmapNoteState::query()->create([
                'username' => $username,
                'note_id' => $noteId,
                'notebook_uri' => $notebookUri,
                'object_uri' => $objectUri,
            ]);

            return;
        }

        $dirty = false;
        if ($row->notebook_uri !== $notebookUri) {
            $row->notebook_uri = $notebookUri;
            $dirty = true;
        }
        if ($objectUri !== null && $row->object_uri !== $objectUri) {
            $row->object_uri = $objectUri;
            $dirty = true;
        }
        if ($dirty) {
            $row->save();
        }
    }

    /**
     * Every note id previously surfaced for this notebook — the destroyed-branch
     * primitive when the collection disappeared since sinceState.
     *
     * @return list<string>
     */
    public function recordedNoteIdsForNotebook(string $username, string $notebookUri): array
    {
        return JmapNoteState::query()
            ->where('username', $username)
            ->where('notebook_uri', $notebookUri)
            ->pluck('note_id')
            ->map(static fn ($id): string => (string) $id)
            ->values()
            ->all();
    }
}
