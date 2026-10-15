<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Collab\DocCollabDocumentService;
use App\Services\Notes\Conversion\NoteJournalConverter;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDOException;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Collaborative note save. Same request the Docs save already sends:
 * markdown plus the full Yjs state, guarded by the state ETag.
 */
final class NoteCollaborativeWrite
{
    public function __construct(
        private readonly NoteRepository $notes,
        private readonly NoteJournalConverter $converter,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly NoteYjsProjection $yjsProjection,
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
    ): string {
        $located = $this->notes->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This notebook is read-only.');

        $bytes = $body['yjs'];
        /** @var array{instance: CalendarInstance, object: CalendarObject, etag: string} $written */
        $written = DB::connection('wgw')->transaction(function () use (
            $located,
            $noteId,
            $body,
            $bytes,
            $ifMatch,
            $ifNoneMatch,
        ): array {
            $object = CalendarObject::query()
                ->whereKey($located['object']->getKey())
                ->lockForUpdate()
                ->first();
            if ($object === null) {
                throw new ApiHttpException(404, 'Note not found.', 'not_found');
            }

            $stored = NoteYjsState::query()
                ->where('calendar_object_id', (int) $object->id)
                ->first();
            $storedEtag = $stored === null
                ? null
                : DocCollabDocumentService::sidecarEtag($this->binaryString($stored->getAttributes()['state'] ?? $stored->state));
            $this->assertStatePrecondition($ifMatch, $ifNoneMatch, $storedEtag);

            $instance = $located['instance'];
            $patch = ['body' => $body['markdown']];
            if (array_key_exists('title', $body)) {
                $patch['title'] = $body['title'];
            }
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            $ics = $this->converter->mergeIntoIcs($raw, $patch);
            try {
                $this->calBackend()->updateCalendarObject(
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

            $this->yjsProjection->store($object, $bytes);

            return [
                'instance' => $instance,
                'object' => $object,
                'etag' => DocCollabDocumentService::sidecarEtag($bytes),
            ];
        });

        $this->notes->indexObject($username, $written['instance'], $written['object']);

        return $written['etag'];
    }

    private function assertStatePrecondition(?string $ifMatch, ?string $ifNoneMatch, ?string $storedEtag): void
    {
        $ifMatch = trim((string) $ifMatch);
        $ifNoneMatch = trim((string) $ifNoneMatch);

        if ($ifMatch === '' && $ifNoneMatch === '') {
            if ($storedEtag !== null) {
                throw new ApiHttpException(
                    428,
                    'If-Match or If-None-Match is required.',
                    'precondition_required',
                );
            }

            return;
        }

        if ($ifNoneMatch === '*' && $storedEtag !== null) {
            throw new ApiHttpException(412, 'Yjs state already exists.', 'precondition_failed');
        }
        if ($ifMatch !== '' && ! OptimisticConcurrency::ifMatchSatisfied($ifMatch, $storedEtag)) {
            throw new ApiHttpException(412, 'Yjs state etag does not match If-Match.', 'precondition_failed');
        }
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }

    private function binaryString(mixed $value): string
    {
        if (is_resource($value)) {
            $contents = stream_get_contents($value);

            return is_string($contents) ? $contents : '';
        }

        return is_string($value) ? $value : '';
    }
}
