<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
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
        private readonly JmapNoteStateService $noteStates = new JmapNoteStateService,
        private readonly BestEffortSearchIndexSync $searchIndexSync = new BestEffortSearchIndexSync,
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

        $starredIds = $this->starredObjectIds($username, $objects->pluck('id')->all());
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
    public function create(string $username, array $payload): array
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
        $this->assertUidAvailable($uid);

        $note = [
            'id' => $uid,
            'title' => $payload['title'] ?? null,
            'body' => is_string($payload['body'] ?? null) ? $payload['body'] : '',
            'categories' => is_array($payload['categories'] ?? null) ? $payload['categories'] : [],
            'status' => $payload['status'] ?? null,
        ];
        $ics = $this->converter->toIcs($note);
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
        OptimisticConcurrency::assertPreconditions(
            $ifMatch,
            $ifUnmodifiedSince,
            (string) $located['object']->etag,
            is_numeric($located['object']->lastmodified) ? (int) $located['object']->lastmodified : null,
            $requirePrecondition,
        );

        $instance = $located['instance'];
        $object = $located['object'];

        if (array_key_exists('notebookId', $patch) && is_string($patch['notebookId']) && $patch['notebookId'] !== '') {
            $destination = $this->notebooks->findAccessibleNotebook($username, $patch['notebookId']);
            if ($destination === null) {
                throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
            }
            $this->collectionAccess->assertCollectionWritable($destination, 'This notebook is read-only.');
            if ((int) $destination->calendarid !== (int) $object->calendarid) {
                $this->assertUidAvailable((string) $object->uid, (int) $object->calendarid);
                $this->moveHelper->move($object, (int) $destination->calendarid);
                $object->refresh();
                $instance = $destination;
            }
        }

        $fieldPatch = $patch;
        unset($fieldPatch['notebookId']);
        if ($fieldPatch !== []) {
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            $ics = $this->converter->mergeIntoIcs($raw, $fieldPatch);
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

        $this->indexObject($username, $instance, $object);
        $starred = NoteStar::query()
            ->where('username', $username)
            ->where('calendar_object_id', (int) $object->id)
            ->exists();

        return $this->rememberedNote(
            $username,
            $object,
            $this->notebooks->apiIdForInstance($instance),
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

        $changes = $this->calBackend()->getChangesForCalendar(
            [(int) $instance->calendarid, (int) $instance->id],
            $this->normalizeSyncToken($since),
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

        $map = [];
        NoteStar::query()
            ->where('username', $username)
            ->whereIn('calendar_object_id', $objectIds)
            ->pluck('calendar_object_id')
            ->each(function (mixed $id) use (&$map): void {
                $map[(int) $id] = true;
            });

        return $map;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function starredNotes(string $username, ?string $status): array
    {
        $stars = NoteStar::query()
            ->where('username', $username)
            ->with('calendarObject')
            ->orderBy('id')
            ->get();

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
     * UID is the collab room key (Decision 7). Uniqueness is global across
     * VJOURNAL objects so a minted or colliding id cannot enter another room.
     * When $exceptCalendarId is set (MOVE), the source calendar is ignored.
     */
    private function assertUidAvailable(string $uid, ?int $exceptCalendarId = null): void
    {
        $query = CalendarObject::query()
            ->where('uid', $uid)
            ->where('componenttype', 'VJOURNAL');
        if ($exceptCalendarId !== null) {
            $query->where('calendarid', '!=', $exceptCalendarId);
        }
        if ($query->exists()) {
            throw new ApiHttpException(409, 'A note with this UID already exists.', 'alreadyExists');
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

    private function indexObject(string $username, CalendarInstance $instance, CalendarObject $object): void
    {
        $path = $this->davPath($username, $instance, (string) $object->uri);
        $this->searchIndexSync->sync(
            'notes',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($path),
            $path,
            $username,
        );
    }

    private function davPath(string $username, CalendarInstance $instance, string $objectUri): string
    {
        $principal = (string) $instance->principaluri;
        $home = str_starts_with($principal, 'principals/') ? substr($principal, strlen('principals/')) : $username;

        return 'calendars/'.$home.'/'.$instance->uri.'/'.$objectUri;
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
