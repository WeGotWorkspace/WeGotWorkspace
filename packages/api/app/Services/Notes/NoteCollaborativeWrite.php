<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Collab\CollabTextState;
use App\Services\Notes\Conversion\NoteJournalConverter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use PDOException;

/**
 * Collaborative note save. Same request the Docs save already sends:
 * markdown plus the full Yjs state, guarded by the state ETag.
 */
final class NoteCollaborativeWrite
{
    public function __construct(
        private readonly WgwCalendarBackendFactory $backends,
        private readonly NoteRepository $notes,
        private readonly NoteJournalConverter $converter,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly CollabTextState $core,
        private readonly NoteTextFields $fields,
    ) {}

    /**
     * @param  array{markdown: string, yjs: string, title?: string}  $body
     */
    public function put(
        string $username,
        string $noteId,
        array $body,
        ?string $ifMatch,
        ?string $ifNoneMatch,
        ?string $externalWriteSeen = null,
    ): string {
        $located = $this->notes->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This notebook is read-only.');

        $bytes = $body['yjs'];
        /** @var array{instance: CalendarInstance, object: CalendarObject, etag: string} $written */
        $written = $this->core->locked(
            $this->fields,
            $located['object'],
            'Note not found.',
            function (CalendarObject $object, ?Model $stored) use (
                $located,
                $noteId,
                $body,
                $bytes,
                $ifMatch,
                $ifNoneMatch,
                $externalWriteSeen,
            ): array {
                $storedEtag = $stored === null ? null : $this->core->stateEtag($stored);
                $this->core->assertStatePrecondition($ifMatch, $ifNoneMatch, $storedEtag);
                NoteArchiveGuard::assertNotArchived($this->converter, $object);
                $this->core->assertNoUnseenExternalWrite($this->fields, $stored, $object, $externalWriteSeen);
                $this->core->assertStateSize($this->fields, $bytes);

                $instance = $located['instance'];
                $patch = ['body' => $body['markdown']];
                if (array_key_exists('title', $body)) {
                    $patch['title'] = $body['title'];
                }
                $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $ics = $this->converter->mergeIntoIcs($raw, $patch);
                try {
                    $this->backends->calBackend()->updateCalendarObject(
                        [(int) $instance->calendarid, (int) $instance->id],
                        (string) $object->uri,
                        $ics,
                    );
                } catch (QueryException|PDOException $exception) {
                    NoteUidConflict::throwIf($exception);
                    throw $exception;
                }

                $object = CalendarObject::query()
                    ->where('calendarid', (int) $instance->calendarid)
                    ->where('uid', $noteId)
                    ->first();
                if ($object === null) {
                    throw new ApiHttpException(500, 'Could not load updated note.', 'server_error');
                }

                return [
                    'instance' => $instance,
                    'object' => $object,
                    'etag' => $this->core->store($this->fields, $object, $bytes),
                ];
            },
        );

        $this->notes->indexObject($username, $written['instance'], $written['object']);

        return $written['etag'];
    }
}
