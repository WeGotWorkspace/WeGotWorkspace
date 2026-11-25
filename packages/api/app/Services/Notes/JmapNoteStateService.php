<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\JmapNoteState;
use App\Services\Calendars\JmapCalendarEventStateService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

/**
 * Survives notebook purge so Note/changes can expand destroyed ids
 * (same role as {@see JmapCalendarEventStateService}).
 */
final class JmapNoteStateService
{
    public function remember(string $username, string $noteId, string $notebookUri, ?string $objectUri = null): void
    {
        if ($username === '' || $noteId === '' || $notebookUri === '') {
            return;
        }

        try {
            $this->persist($username, $noteId, $notebookUri, $objectUri);
        } catch (QueryException $exception) {
            $this->logFailure('remember', $username, $noteId, $exception);
        }
    }

    /**
     * {@see remember()} for a batch: one read of the existing rows, one batched
     * insert for the missing ones, and a write only for a row whose notebook or
     * object uri changed. A read of unchanged notes writes nothing.
     *
     * @param  list<array{noteId: string, notebookUri: string, objectUri: string|null}>  $entries
     */
    public function rememberMany(string $username, array $entries): void
    {
        $entries = array_values(array_filter(
            $entries,
            static fn (array $e): bool => $username !== '' && $e['noteId'] !== '' && $e['notebookUri'] !== '',
        ));
        if ($entries === []) {
            return;
        }

        try {
            $rows = [];
            foreach (JmapNoteState::query()
                ->where('username', $username)
                ->whereIn('note_id', array_column($entries, 'noteId'))
                ->get() as $row) {
                $rows[(string) $row->note_id] = $row;
            }

            $now = now();
            $missing = [];
            foreach ($entries as $e) {
                $row = $rows[$e['noteId']] ?? null;
                if ($row === null) {
                    $missing[$e['noteId']] = [
                        'username' => $username,
                        'note_id' => $e['noteId'],
                        'notebook_uri' => $e['notebookUri'],
                        'object_uri' => $e['objectUri'],
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];

                    continue;
                }
                $dirty = false;
                if ($row->notebook_uri !== $e['notebookUri']) {
                    $row->notebook_uri = $e['notebookUri'];
                    $dirty = true;
                }
                if ($e['objectUri'] !== null && $row->object_uri !== $e['objectUri']) {
                    $row->object_uri = $e['objectUri'];
                    $dirty = true;
                }
                if ($dirty) {
                    $row->save();
                }
            }
            if ($missing !== []) {
                JmapNoteState::query()->insertOrIgnore(array_values($missing));
            }
        } catch (QueryException $exception) {
            $this->logFailure('rememberMany', $username, (string) $entries[0]['noteId'], $exception);
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
        try {
            return array_values(JmapNoteState::query()
                ->where('username', $username)
                ->where('notebook_uri', $notebookUri)
                ->pluck('note_id')
                ->map(static fn ($id): string => (string) $id)
                ->all());
        } catch (QueryException $exception) {
            $this->logFailure('recordedNoteIdsForNotebook', $username, $notebookUri, $exception);

            return [];
        }
    }

    private function persist(string $username, string $noteId, string $notebookUri, ?string $objectUri): void
    {
        // firstOrCreate falls back to createOrFirst: a concurrent insert of the same
        // (username, note_id) is read back instead of being logged as a failure.
        $row = JmapNoteState::query()->firstOrCreate(
            ['username' => $username, 'note_id' => $noteId],
            ['notebook_uri' => $notebookUri, 'object_uri' => $objectUri],
        );

        if ($row->wasRecentlyCreated) {
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

    private function logFailure(string $op, string $username, string $key, QueryException $exception): void
    {
        try {
            Log::error('jmap_note_state_failed', [
                'op' => $op,
                'username' => $username,
                'key' => $key,
                'message' => $exception->getMessage(),
            ]);
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }
}
