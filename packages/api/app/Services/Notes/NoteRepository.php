<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Events\EventDispatch;
use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Models\NoteYjsState;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Collab\DocCollabDocumentService;
use App\Services\Collab\YjsBytes;
use App\Services\Collab\YjsPayloadException;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use PDOException;
use Sabre\CalDAV\Backend\PDO as CalPDO;

final class NoteRepository
{
    public function __construct(
        private readonly NotebookRepository $notebooks,
        private readonly NoteJournalConverter $converter,
        private readonly NoteMoveHelper $moveHelper,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly SearchIndexerService $searchIndexer,
        private readonly NoteYjsProjection $yjsProjection,
        private readonly JmapNoteStateService $noteStates = new JmapNoteStateService,
        private readonly BestEffortSearchIndexSync $searchIndexSync = new BestEffortSearchIndexSync,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username, ?string $notebookId, ?bool $starred, ?string $status): array
    {
        if ($starred === true) {
            return ['list' => $this->starredNotes($username, $status)];
        }

        if ($notebookId === null || trim($notebookId) === '') {
            throw new ApiHttpException(400, 'notebookId is required.', 'bad_request');
        }

        $instance = $this->notebooks->findAccessibleNotebook($username, $notebookId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }

        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VJOURNAL')
            ->orderBy('id')
            ->get();

        $objectIds = [];
        foreach ($objects->pluck('id') as $id) {
            if (is_int($id) || (is_string($id) && $id !== '')) {
                $objectIds[] = $id;
            }
        }
        $starredIds = $this->starredObjectIds($username, $objectIds);
        $apiId = $this->notebooks->apiIdForInstance($instance);
        $notes = [];
        foreach ($objects as $object) {
            $note = $this->rememberedNote($username, $object, $apiId, isset($starredIds[(int) $object->id]));
            if ($status === 'CANCELLED' && ($note['status'] ?? null) !== 'CANCELLED') {
                continue;
            }
            if ($status === 'active' && ($note['status'] ?? null) === 'CANCELLED') {
                continue;
            }
            $notes[] = $note;
        }

        return ['list' => $notes];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $noteId): array
    {
        $located = $this->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }

        $starred = NoteStar::query()
            ->where('username', $username)
            ->where('calendar_object_id', (int) $located['object']->id)
            ->exists();

        return $this->rememberedNote(
            $username,
            $located['object'],
            $this->notebooks->apiIdForInstance($located['instance']),
            $starred,
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload, bool $allowStoredTags = false): array
    {
        $notebookId = is_string($payload['notebookId'] ?? null) ? $payload['notebookId'] : '';
        $instance = $this->notebooks->findAccessibleNotebook($username, $notebookId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($instance, 'This notebook is read-only.');

        // Decision 7: room key = UID. Always mint so clients cannot aim at
        // another principal's collab room. Client-supplied `uid` is ignored.
        $uid = (string) Str::uuid();
        $this->moveHelper->assertUidAvailable($uid);

        $note = [
            'id' => $uid,
            'title' => $payload['title'] ?? null,
            'body' => is_string($payload['body'] ?? null) ? $payload['body'] : '',
            'categories' => is_array($payload['categories'] ?? null) ? $payload['categories'] : [],
            'status' => $payload['status'] ?? null,
        ];
        $ics = $this->converter->toIcs($note, $allowStoredTags);
        $objectUri = $uid.'.ics';

        try {
            $this->calBackend()->createCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                $objectUri,
                $ics,
            );
        } catch (QueryException|PDOException $exception) {
            NoteUidConflict::throwIf($exception);
            throw $exception;
        }

        $object = $this->findObjectByUid((int) $instance->calendarid, $uid);
        if ($object === null) {
            throw new ApiHttpException(500, 'Could not load created note.', 'server_error');
        }
        $this->indexObject($username, $instance, $object);

        return $this->rememberedNote($username, $object, $this->notebooks->apiIdForInstance($instance));
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public function patch(
        string $username,
        string $noteId,
        array $patch,
        ?string $ifMatch,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        $located = $this->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This notebook is read-only.');
        $yjsBytes = $this->yjsBytesFromPatch($patch);

        // Lock the row for the precondition check and the write. A concurrent
        // PATCH then waits instead of both passing the same ETag.
        /** @var array{instance: CalendarInstance, object: CalendarObject} $updated */
        $updated = DB::connection('wgw')->transaction(function () use (
            $located,
            $username,
            $noteId,
            $patch,
            $ifMatch,
            $ifUnmodifiedSince,
            $requirePrecondition,
            $yjsBytes,
        ): array {
            $object = CalendarObject::query()
                ->whereKey($located['object']->getKey())
                ->lockForUpdate()
                ->first();
            if ($object === null) {
                throw new ApiHttpException(404, 'Note not found.', 'not_found');
            }
            OptimisticConcurrency::assertPreconditions(
                $ifMatch,
                $ifUnmodifiedSince,
                (string) $object->etag,
                is_numeric($object->lastmodified) ? (int) $object->lastmodified : null,
                $requirePrecondition,
            );

            $instance = $located['instance'];
            if (array_key_exists('categories', $patch) && is_array($patch['categories'])) {
                $storedIcs = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $this->assertNewCategoriesAllowed($storedIcs, array_values($patch['categories']));
            }
            $patch = $this->expandCategoryDelta($object, $patch);

            $moved = false;
            if (array_key_exists('notebookId', $patch) && is_string($patch['notebookId']) && $patch['notebookId'] !== '') {
                $destination = $this->notebooks->findAccessibleNotebook($username, $patch['notebookId']);
                if ($destination === null) {
                    throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
                }
                $this->collectionAccess->assertCollectionWritable($destination, 'This notebook is read-only.');
                if ((int) $destination->calendarid !== (int) $object->calendarid) {
                    $this->moveHelper->assertUidAvailable((string) $object->uid, (int) $object->calendarid);
                    $this->moveHelper->move($object, (int) $destination->calendarid);
                    $object->refresh();
                    $instance = $destination;
                    $moved = true;
                }
            }

            $fieldPatch = $patch;
            unset($fieldPatch['notebookId'], $fieldPatch['yjs']);
            $metadataPatch = $fieldPatch;
            unset($metadataPatch['body']);
            if ($fieldPatch !== [] || $moved) {
                $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $ics = $fieldPatch !== [] ? $this->converter->mergeIntoIcs($raw, $fieldPatch) : $raw;
                if ($metadataPatch !== [] || $moved) {
                    $ics = $this->converter->touchLastModified($ics);
                }
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
                $object = $this->findObjectByUid((int) $instance->calendarid, $noteId);
                if ($object === null) {
                    throw new ApiHttpException(500, 'Could not load updated note.', 'server_error');
                }
            }

            if ($yjsBytes !== null) {
                $this->storeYjsState($object, $yjsBytes);
            }

            return ['instance' => $instance, 'object' => $object];
        });

        $this->indexObject($username, $updated['instance'], $updated['object']);
        $starred = NoteStar::query()
            ->where('username', $username)
            ->where('calendar_object_id', (int) $updated['object']->id)
            ->exists();

        return $this->rememberedNote(
            $username,
            $updated['object'],
            $this->notebooks->apiIdForInstance($updated['instance']),
            $starred,
        );
    }

    /**
     * @return array{ok: true}
     */
    public function delete(
        string $username,
        string $noteId,
        ?string $ifMatch,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        $located = $this->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This notebook is read-only.');
        OptimisticConcurrency::assertPreconditions(
            $ifMatch,
            $ifUnmodifiedSince,
            (string) $located['object']->etag,
            is_numeric($located['object']->lastmodified) ? (int) $located['object']->lastmodified : null,
            $requirePrecondition,
        );

        $this->calBackend()->deleteCalendarObject(
            [(int) $located['instance']->calendarid, (int) $located['instance']->id],
            (string) $located['object']->uri,
        );
        $this->searchIndexSync->sync(
            'notes',
            fn () => $this->searchIndexer->deleteDavPath(
                $this->davPath($username, $located['instance'], (string) $located['object']->uri),
            ),
            $this->davPath($username, $located['instance'], (string) $located['object']->uri),
            $username,
        );

        return ['ok' => true];
    }

    /**
     * @return array{ok: true}
     */
    public function star(string $username, string $noteId): array
    {
        $located = $this->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }

        NoteStar::query()->firstOrCreate([
            'username' => $username,
            'calendar_object_id' => (int) $located['object']->id,
        ], [
            'note_uid' => (string) $located['object']->uid,
        ]);

        return ['ok' => true];
    }

    /**
     * @return array{ok: true}
     */
    public function unstar(string $username, string $noteId): array
    {
        $located = $this->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }

        NoteStar::query()
            ->where('username', $username)
            ->where('calendar_object_id', (int) $located['object']->id)
            ->delete();

        return ['ok' => true];
    }

    /**
     * @return array{oldState: string, newState: string, created: list<string>, updated: list<string>, destroyed: list<string>, hasMoreChanges?: bool}
     */
    public function changes(string $username, string $notebookId, ?string $since): array
    {
        $instance = $this->notebooks->findAccessibleNotebook($username, $notebookId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }

        $syncToken = $this->normalizeSyncToken($since);
        // Sabre's PDO backend treats a falsy token as the initial sync.
        $changes = $this->calBackend()->getChangesForCalendar(
            [(int) $instance->calendarid, (int) $instance->id],
            $syncToken === null ? '0' : (string) $syncToken,
            1,
        );
        if ($changes === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return [
            'oldState' => ($since === null || $since === '') ? '0' : $since,
            'newState' => (string) $changes['syncToken'],
            'hasMoreChanges' => false,
            'created' => $this->uidsForUris((int) $instance->calendarid, $changes['added'] ?? []),
            'updated' => $this->uidsForUris((int) $instance->calendarid, $changes['modified'] ?? []),
            'destroyed' => $this->destroyedUids($changes['deleted'] ?? []),
        ];
    }

    /**
     * @return array<string, string>
     */
    public function notebookSyncTokens(string $username): array
    {
        return $this->notebooks->notebookSyncTokens($username);
    }

    /**
     * @return list<string>
     */
    public function noteIdsInNotebook(string $username, string $notebookId): array
    {
        try {
            $list = $this->list($username, $notebookId, null, null)['list'];
        } catch (ApiHttpException) {
            return [];
        }

        $ids = [];
        foreach ($list as $note) {
            if (isset($note['id']) && is_string($note['id']) && $note['id'] !== '') {
                $ids[] = $note['id'];
            }
        }

        return $ids;
    }

    /**
     * Raw Yjs bytes for one note, or null when the note exists and has no row.
     * List and ordinary detail reads do not call this.
     *
     * @return array{bytes: string, etag: string, externalWrite: bool}|null
     */
    public function yjsSnapshot(string $username, string $noteId): ?array
    {
        $located = $this->findAccessibleNote($username, $noteId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Note not found.', 'not_found');
        }

        $row = NoteYjsState::query()
            ->where('calendar_object_id', (int) $located['object']->id)
            ->first();
        if ($row === null) {
            return null;
        }

        $bytes = $this->binaryString($row->getAttributes()['state'] ?? $row->state);

        return [
            'bytes' => $bytes,
            // The state tag moves only when the bytes move. The journal ETag stays on the JSON GET.
            'etag' => DocCollabDocumentService::sidecarEtag($bytes),
            'externalWrite' => $this->yjsProjection->isExternalContentWrite($row, $located['object']),
        ];
    }

    /**
     * @return array{object: CalendarObject, instance: CalendarInstance}|null
     */
    public function findAccessibleNote(string $username, string $noteId): ?array
    {
        $objects = CalendarObject::query()
            ->where('uid', $noteId)
            ->where('componenttype', 'VJOURNAL')
            ->get();

        foreach ($objects as $object) {
            $instance = $this->accessibleInstanceForCalendar($username, (int) $object->calendarid);
            if ($instance !== null) {
                return ['object' => $object, 'instance' => $instance];
            }
        }

        return null;
    }

    private function accessibleInstanceForCalendar(string $username, int $calendarId): ?CalendarInstance
    {
        return $this->notebooks->findAccessibleInstanceForCalendar($username, $calendarId);
    }

    /**
     * @param  list<int|string>  $objectIds
     * @return array<int, true>
     */
    private function starredObjectIds(string $username, array $objectIds): array
    {
        if ($objectIds === []) {
            return [];
        }

        try {
            $map = [];
            NoteStar::query()
                ->where('username', $username)
                ->whereIn('calendar_object_id', $objectIds)
                ->pluck('calendar_object_id')
                ->each(function (mixed $id) use (&$map): void {
                    $map[(int) $id] = true;
                });

            return $map;
        } catch (QueryException $exception) {
            $this->logAuxiliaryTableFailure('note_stars', $username, $exception);

            return [];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function starredNotes(string $username, ?string $status): array
    {
        try {
            $stars = NoteStar::query()
                ->where('username', $username)
                ->with('calendarObject')
                ->orderBy('id')
                ->get();
        } catch (QueryException $exception) {
            $this->logAuxiliaryTableFailure('note_stars', $username, $exception);

            return [];
        }

        $notes = [];
        foreach ($stars as $star) {
            $object = $star->calendarObject;
            if (! $object instanceof CalendarObject || (string) $object->componenttype !== 'VJOURNAL') {
                continue;
            }
            $instance = $this->accessibleInstanceForCalendar($username, (int) $object->calendarid);
            if ($instance === null) {
                continue;
            }
            $note = $this->rememberedNote($username, $object, $this->notebooks->apiIdForInstance($instance), true);
            if ($status === 'CANCELLED' && ($note['status'] ?? null) !== 'CANCELLED') {
                continue;
            }
            $notes[] = $note;
        }

        return $notes;
    }

    /**
     * @return array<string, mixed>
     */
    private function rememberedNote(
        string $username,
        CalendarObject $object,
        string $notebookUri,
        bool $starred = false,
    ): array {
        $note = $this->converter->fromObject($object, $notebookUri, $starred);
        $this->noteStates->remember(
            $username,
            (string) ($note['id'] ?? $object->uid),
            $notebookUri,
            is_string($object->uri) ? (string) $object->uri : null,
        );

        return $note;
    }

    /**
     * Apply categoriesAdd/categoriesRemove to the tags on the locked row, then
     * hand mergeIntoIcs a full categories list. Remove runs before add.
     *
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    private function expandCategoryDelta(CalendarObject $object, array $patch): array
    {
        $hasAdd = array_key_exists('categoriesAdd', $patch);
        $hasRemove = array_key_exists('categoriesRemove', $patch);
        if (! $hasAdd && ! $hasRemove) {
            return $patch;
        }
        if (array_key_exists('categories', $patch)) {
            throw new ApiHttpException(400, 'Send categories or a tag delta, not both.', 'bad_request');
        }

        $storedIcs = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $add = is_array($patch['categoriesAdd'] ?? null) ? array_values($patch['categoriesAdd']) : [];
        $remove = is_array($patch['categoriesRemove'] ?? null) ? array_values($patch['categoriesRemove']) : [];
        if ($hasAdd) {
            $this->assertNewCategoriesAllowed($storedIcs, $add);
        }
        $patch['categories'] = NoteTag::applyDelta(
            $this->converter->storedCategories($storedIcs),
            $add,
            $remove,
        );
        unset($patch['categoriesAdd'], $patch['categoriesRemove']);

        return $patch;
    }

    /**
     * A new tag must match {@see NoteTag::PATTERN}. A tag already on the note
     * is allowed through so the next edit does not delete it.
     *
     * @param  list<mixed>  $submitted
     */
    private function assertNewCategoriesAllowed(string $ics, array $submitted): void
    {
        $existing = $this->converter->storedCategories($ics);
        $normalized = NoteTag::normalizeStored($submitted);
        if (NoteTag::mergeForUpdate($submitted, $existing) !== $normalized) {
            throw new ApiHttpException(400, 'A tag may only use letters a-z and hyphen.', 'bad_request');
        }
    }

    private function findObjectByUid(int $calendarId, string $uid): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', $uid)
            ->first();
    }

    /**
     * @param  list<string>  $uris
     * @return list<string>
     */
    private function uidsForUris(int $calendarId, array $uris): array
    {
        $uids = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $object = CalendarObject::query()
                ->where('calendarid', $calendarId)
                ->where('uri', $uri)
                ->first();
            if ($object !== null && is_string($object->uid) && $object->uid !== '') {
                $uids[] = (string) $object->uid;
            }
        }

        return $uids;
    }

    /**
     * @param  list<string>  $uris
     * @return list<string>
     */
    /**
     * Deleted objects are gone, so uid is recovered from the `{uid}.ics` href
     * (WGW create always writes that convenience name; Decision 3).
     *
     * @param  list<string>  $uris
     * @return list<string>
     */
    private function destroyedUids(array $uris): array
    {
        $uids = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $uid = $this->uidFromUri($uri);
            if ($uid !== '') {
                $uids[] = $uid;
            }
        }

        return array_values(array_unique($uids));
    }

    private function uidFromUri(string $uri): string
    {
        return str_ends_with($uri, '.ics') ? substr($uri, 0, -4) : $uri;
    }

    private function normalizeSyncToken(?string $since): ?int
    {
        if ($since === null || $since === '' || $since === '0') {
            return null;
        }
        if (! ctype_digit($since)) {
            return null;
        }

        return (int) $since;
    }

    public function indexObject(string $username, CalendarInstance $instance, CalendarObject $object): void
    {
        $path = $this->davPath($username, $instance, (string) $object->uri);
        $this->searchIndexSync->sync(
            'notes',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($path),
            $path,
            $username,
        );
        $this->eventDispatch->fireMutation($username, 'notes', 'written', $path);
    }

    private function davPath(string $username, CalendarInstance $instance, string $objectUri): string
    {
        $principal = (string) $instance->principaluri;
        $home = str_starts_with($principal, 'principals/') ? substr($principal, strlen('principals/')) : $username;

        return 'calendars/'.$home.'/'.$instance->uri.'/'.$objectUri;
    }

    private function logAuxiliaryTableFailure(string $table, string $username, QueryException $exception): void
    {
        try {
            Log::warning('notes_auxiliary_table_failed', [
                'table' => $table,
                'username' => $username,
                'message' => $exception->getMessage(),
            ]);
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function yjsBytesFromPatch(array $patch): ?string
    {
        if (! array_key_exists('yjs', $patch)) {
            return null;
        }

        $yjs = $patch['yjs'];
        if (is_string($yjs)) {
            if (strlen($yjs) > YjsBytes::MAX_BYTES) {
                throw new ApiHttpException(413, 'Yjs state exceeds the 5 MiB limit.', 'payload_too_large');
            }

            return $yjs;
        }

        try {
            return YjsBytes::decode($yjs);
        } catch (YjsPayloadException $e) {
            throw new ApiHttpException(
                $e->status,
                $e->status === 413
                    ? 'Yjs state exceeds the 5 MiB limit.'
                    : 'Yjs state must be a list of bytes from 0 to 255.',
                $e->status === 413 ? 'payload_too_large' : 'bad_request',
            );
        }
    }

    private function storeYjsState(CalendarObject $object, string $bytes): void
    {
        $this->yjsProjection->store($object, $bytes);
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
