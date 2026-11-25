<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Events\EventDispatch;
use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\TaskYjsState;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Collab\CollabTextState;
use App\Services\Notify\TaskStatusChangedNotify;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Services\Tasks\Conversion\ConversionSupport;
use App\Services\VObject\ICalendarInPlacePatcher;
use App\Services\VObject\VJournalUidGuard;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

final class TaskRepository
{
    public function __construct(
        private readonly WgwCalendarBackendFactory $backends,
        private readonly TaskMapper $mapper,
        private readonly TaskListRepository $taskLists,
        private readonly SearchIndexerService $searchIndexer,
        private readonly TaskLocator $locator,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly CollabTextState $textCore,
        private readonly TaskTextFields $textFields,
        private readonly TaskAssigneeGuard $assignees,
        private readonly TaskChangeReactions $changeReactions,
        private readonly BestEffortSearchIndexSync $searchIndexSync = new BestEffortSearchIndexSync,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /** Stored tasks read from the database per round trip while a list is mapped. */
    private const LIST_READ_CHUNK = 100;

    /** Largest page `GET /tasks/items` serves (stored objects, not mapped tasks). */
    public const LIST_PAGE_MAX = 500;

    /**
     * One task list, in URI order. Without `$limit` the whole list is read (the
     * original contract); with it, at most `$limit` stored objects after the
     * `$cursor` and a `nextCursor` to continue from (null on the last page).
     * Each stored object is mapped (and with `$lean` projected to the list
     * fields) one at a time, so only the answer is held, never the parsed
     * objects. Lean also skips the participants lookup.
     *
     * @return array{list: list<array<string, mixed>>, nextCursor?: string|null}
     */
    public function list(
        string $username,
        string $taskListId,
        ?int $limit = null,
        ?string $cursor = null,
        bool $lean = false,
    ): array {
        Log::withContext(['principal' => $username]);

        $instance = $this->taskLists->findAccessibleTaskList($username, $taskListId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }

        $mapper = $this->mapper->forViewer($username);
        $tasks = [];
        $read = 0;
        $last = $cursor;
        $more = false;
        foreach ($this->todoObjectsInUriOrder((int) $instance->calendarid, $cursor) as $object) {
            if ($limit !== null && $read >= $limit) {
                $more = true;
                break;
            }
            $read++;
            $last = (string) $object->uri;
            try {
                foreach ($mapper->toTasks($object, $taskListId, $lean) as $task) {
                    $tasks[] = $task;
                }
            } catch (ApiHttpException $e) {
                if (VObjectPayloadGuard::isPayloadBoundError($e)) {
                    continue;
                }
                throw $e;
            }
        }

        if ($limit === null) {
            return ['list' => $tasks];
        }

        return ['list' => $tasks, 'nextCursor' => $more ? $last : null];
    }

    /**
     * The VTODO objects of a calendar after `$after`, in URI order, read in
     * chunks so the rows of a big list are never all in memory at once.
     *
     * @return \Generator<int, CalendarObject>
     */
    private function todoObjectsInUriOrder(int $calendarId, ?string $after): \Generator
    {
        $after = $after === '' ? null : $after;
        while (true) {
            $query = CalendarObject::query()
                ->where('calendarid', $calendarId)
                ->where('componenttype', 'VTODO')
                ->orderBy('uri')
                ->limit(self::LIST_READ_CHUNK);
            if ($after !== null) {
                $query->where('uri', '>', $after);
            }
            $count = 0;
            foreach ($query->get() as $object) {
                $count++;
                $after = (string) $object->uri;
                yield $object;
            }
            if ($count < self::LIST_READ_CHUNK) {
                return;
            }
        }
    }

    /**
     * @param  array<string, mixed>  $filter
     * @return array<string, mixed>
     */
    public function query(string $username, array $filter, ?int $limit = null): array
    {
        $taskListId = $filter['inTaskList'] ?? null;
        if (! is_string($taskListId) || trim($taskListId) === '') {
            throw new ApiHttpException(400, 'filter.inTaskList is required.', 'bad_request');
        }

        $instance = $this->taskLists->findAccessibleTaskList($username, $taskListId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }

        $uidFilter = isset($filter['uid']) && is_string($filter['uid']) ? $filter['uid'] : null;
        $objects = $this->todoObjectsInUriOrder((int) $instance->calendarid, null);

        $ids = [];
        $total = 0;
        foreach ($objects as $object) {
            try {
                foreach ($this->mapper->toTasks($object, $taskListId, true) as $task) {
                    if ($uidFilter !== null && ($task['uid'] ?? null) !== $uidFilter) {
                        continue;
                    }
                    $id = (string) ($task['id'] ?? '');
                    if ($id === '') {
                        continue;
                    }
                    $total++;
                    if ($limit === null || count($ids) < $limit) {
                        $ids[] = $id;
                    }
                }
            } catch (ApiHttpException $e) {
                if (VObjectPayloadGuard::isPayloadBoundError($e)) {
                    continue;
                }
                throw $e;
            }
        }

        return ['ids' => $ids, 'total' => $total];
    }

    /**
     * The task and the list instance $username sees it through, or null when
     * they cannot see it. For the task thread subject (#2173).
     *
     * @return array{instance: CalendarInstance, task: array<string, mixed>}|null
     */
    public function locate(string $username, string $taskId): ?array
    {
        $located = $this->locator->find($username, $taskId);
        if ($located === null) {
            return null;
        }
        $task = $this->mapper->forViewer($username)->toTask($located['object'], $located['taskListUri'], $located['vtodoUid']);

        return $task === null ? null : ['instance' => $located['instance'], 'task' => $task];
    }

    /** @return array<string, mixed> */
    public function show(string $username, string $taskId): array
    {
        $located = $this->locator->find($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $task = $this->mapper->forViewer($username)->toTask(
            $located['object'],
            $located['taskListUri'],
            $located['vtodoUid'],
        );
        if ($task === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        return $task;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        $instance = $this->resolveTaskListFromPayload($username, $payload);
        $this->collectionAccess->assertCollectionWritable($instance, 'This task list is read-only.');
        $taskPayload = $this->assignees->prepare(null, $this->normalizeTaskPayload($payload), $instance, $username);
        $objectUri = $this->allocateObjectUri((int) $instance->calendarid, $taskPayload);
        $ics = $this->mapper->toIcs($taskPayload);

        try {
            $this->backends->calBackend()->createCalendarObject(
                [(int) $instance->calendarid, (int) $instance->id],
                $objectUri,
                $ics,
            );
        } catch (\PDOException $exception) {
            // Another send with this UID won the race for the `calendarid_uid` index.
            VJournalUidGuard::throwIfUniqueViolation($exception, 'A task with this UID already exists.');
            throw $exception;
        }
        $davPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);
        $this->searchIndexSync->sync(
            'tasks',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );
        $this->eventDispatch->fireMutation($username, 'tasks', 'created', $davPath);

        $object = $this->findObjectInCalendar((int) $instance->calendarid, $objectUri);
        if ($object === null) {
            throw new ApiHttpException(500, 'Could not load created task.', 'server_error');
        }

        $taskListId = $this->taskListUriForInstance($instance);
        $task = $this->mapper->forViewer($username)->toTask($object, $taskListId);
        if ($task === null) {
            throw new ApiHttpException(500, 'Could not load created task.', 'server_error');
        }
        $this->changeReactions->afterWrite($username, $instance, null, $task);

        return $task;
    }

    /**
     * The task a repeated create already made (#2155): the same client UID in
     * the same task list. A resend after a lost or cancelled response gets it
     * instead of a second task. Null when the UID is new in that list.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>|null
     */
    public function existingCreateForRetry(string $username, array $payload): ?array
    {
        $uid = $payload['uid'] ?? null;
        if (! is_string($uid) || trim($uid) === '') {
            return null;
        }
        $instance = $this->resolveTaskListFromPayload($username, $payload);
        $this->collectionAccess->assertCollectionWritable($instance, 'This task list is read-only.');
        $object = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('uid', $uid)
            ->where('componenttype', 'VTODO')
            ->first();

        return $object === null ? null : $this->mapper->forViewer($username)->toTask($object, $this->taskListUriForInstance($instance));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(
        string $username,
        string $taskId,
        array $payload,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        return $this->rewriteOwnedTask(
            $username,
            $taskId,
            static fn (array $existingTask): array => $payload,
            $ifMatch,
            $ifUnmodifiedSince,
            $requirePrecondition,
            'Could not load updated task.',
            self::requestedTaskListId($payload),
        );
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public function patch(
        string $username,
        string $taskId,
        array $patch,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        $this->assignees->assertPatchUsesStableIds($patch);

        return $this->rewriteOwnedTask(
            $username,
            $taskId,
            static fn (array $existingTask): array => ConversionSupport::deepMergeTaskPatch($existingTask, $patch),
            $ifMatch,
            $ifUnmodifiedSince,
            $requirePrecondition,
            'Could not load patched task.',
        );
    }

    /**
     * The live-text save (#2208): a title and description patch on the shared
     * write path. `$guard` checks the locked object and its state row before
     * anything is written; `$afterWrite` stores the state in the same
     * transaction as the object.
     *
     * @param  array{title: string, description: string|null}  $patch
     * @param  callable(CalendarObject, Model|null): void  $guard
     * @param  callable(CalendarObject): void  $afterWrite
     * @return array<string, mixed>
     */
    public function patchText(string $username, string $taskId, array $patch, callable $guard, callable $afterWrite): array
    {
        return $this->rewriteOwnedTask(
            $username,
            $taskId,
            static fn (array $existingTask): array => ConversionSupport::deepMergeTaskPatch($existingTask, $patch),
            null,
            null,
            false,
            'Could not load patched task.',
            guard: $guard,
            afterWrite: $afterWrite,
        );
    }

    /**
     * Shared write path for {@see update()}, {@see patch()} and
     * {@see patchText()}: checks access, then under the live-text core's lock
     * checks the preconditions on the locked row, rewrites the VTODO from that
     * row, re-indexes it and returns the stored task. A text save every few
     * seconds cannot be overwritten by a write that read the task before it
     * (#2208). A `$targetListId` naming another list moves the task there
     * (#1813); its id stays the same, since the id is the object's URI.
     *
     * @param  callable(array<string, mixed>): array<string, mixed>  $buildPayload  maps the existing task to the payload to normalize
     * @param  (callable(CalendarObject, Model|null): void)|null  $guard
     * @param  (callable(CalendarObject): void)|null  $afterWrite
     * @return array<string, mixed>
     */
    private function rewriteOwnedTask(
        string $username,
        string $taskId,
        callable $buildPayload,
        ?string $ifMatch,
        ?string $ifUnmodifiedSince,
        bool $requirePrecondition,
        string $reloadFailedMessage,
        ?string $targetListId = null,
        ?callable $guard = null,
        ?callable $afterWrite = null,
    ): array {
        $located = $this->locator->find($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This task list is read-only.');

        $instance = $located['instance'];
        $vtodoUid = $located['vtodoUid'];
        $objectUri = (string) $located['object']->uri;
        $taskListId = $this->taskListUriForInstance($instance);
        /** @var array{0: array<string, mixed>, 1: CalendarInstance, 2: CalendarObject} $written */
        $written = $this->textCore->locked(
            $this->textFields->forComponent($vtodoUid),
            $located['object'],
            'Task not found.',
            function (CalendarObject $object, ?Model $state) use (
                $username, $buildPayload, $ifMatch, $ifUnmodifiedSince, $requirePrecondition, $reloadFailedMessage,
                $targetListId, $guard, $afterWrite, $instance, $vtodoUid, $objectUri, $taskListId,
            ): array {
                $this->assertObjectPreconditions($object, $ifMatch, $ifUnmodifiedSince, $requirePrecondition);
                $existingTask = $this->mapper->forViewer($username)->toTask($object, $taskListId, $vtodoUid);
                if ($existingTask === null) {
                    throw new ApiHttpException(404, 'Task not found.', 'not_found');
                }
                if ($guard !== null) {
                    $guard($object, $state);
                }

                $target = $this->resolveMoveTarget($username, $targetListId, $instance, $objectUri, $vtodoUid);
                $taskPayload = $this->assignees->prepare(
                    $existingTask,
                    $this->normalizeTaskPayload($buildPayload($existingTask), $existingTask),
                    $target,
                    $username,
                    $instance,
                );
                $taskPayload['id'] = $existingTask['id'];
                $taskPayload['taskListId'] = $this->taskListUriForInstance($target);
                $taskPayload['uid'] = $existingTask['uid'];

                $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $ics = $this->updatedIcs($raw, $taskPayload, $existingTask, $vtodoUid);

                $sourceIds = [(int) $instance->calendarid, (int) $instance->id];
                if ($target === $instance) {
                    $this->backends->calBackend()->updateCalendarObject($sourceIds, $objectUri, $ics);
                } else {
                    $this->backends->calBackend()->createCalendarObject([(int) $target->calendarid, (int) $target->id], $objectUri, $ics);
                    // The stored state does not move: it can hold deleted text and
                    // who typed it, which the new list's audience must not read
                    // (#2208). The next join seeds from the text the VTODO carries.
                    TaskYjsState::query()->where('calendar_object_id', (int) $object->id)->delete();
                    $this->backends->calBackend()->deleteCalendarObject($sourceIds, $objectUri);
                }

                $updated = $this->findObjectInCalendar((int) $target->calendarid, $objectUri);
                if ($updated === null) {
                    throw new ApiHttpException(500, $reloadFailedMessage, 'server_error');
                }
                if ($afterWrite !== null) {
                    $afterWrite($updated);
                }

                return [$existingTask, $target, $updated];
            },
        );
        [$existingTask, $target, $updated] = $written;
        $targetListUri = $this->taskListUriForInstance($target);

        if ($target !== $instance) {
            $oldPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);
            $this->searchIndexSync->sync(
                'tasks',
                fn () => $this->searchIndexer->deleteDavPath($oldPath),
                $oldPath,
                $username,
            );
        }
        $davPath = $this->calendarDavPath($username, (string) $target->uri, $objectUri);
        $this->searchIndexSync->sync(
            'tasks',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $task = $this->mapper->forViewer($username)->toTask($updated, $targetListUri, $vtodoUid);
        if ($task === null) {
            throw new ApiHttpException(500, $reloadFailedMessage, 'server_error');
        }

        $this->notifyStatusChanged($username, $target, $existingTask, $task);
        $this->changeReactions->afterWrite($username, $target, $existingTask, $task);

        return $task;
    }

    /**
     * The list a PUT body names in `taskListIds`, or null when it names none.
     *
     * @param  array<string, mixed>  $payload
     */
    private static function requestedTaskListId(array $payload): ?string
    {
        $taskListIds = $payload['taskListIds'] ?? null;
        if (! is_array($taskListIds)) {
            return null;
        }
        foreach ($taskListIds as $id => $enabled) {
            if ($enabled === true && (string) $id !== '') {
                return (string) $id;
            }
        }

        return null;
    }

    /**
     * The list a write lands in: `$current`, or the writable list `$targetListId`
     * names when that is another calendar. A task that shares its file with
     * other tasks cannot move on its own, and the target must not already hold
     * a file with the same name.
     */
    private function resolveMoveTarget(
        string $username,
        ?string $targetListId,
        CalendarInstance $current,
        string $objectUri,
        ?string $vtodoUid,
    ): CalendarInstance {
        if ($targetListId === null || $targetListId === $this->taskListUriForInstance($current)) {
            return $current;
        }
        $target = $this->taskLists->findAccessibleTaskList($username, $targetListId);
        if ($target === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }
        if ((int) $target->calendarid === (int) $current->calendarid) {
            return $current;
        }
        $this->collectionAccess->assertCollectionWritable($target, 'This task list is read-only.');
        if ($vtodoUid !== null) {
            throw new ApiHttpException(409, 'This task shares its file with other tasks and cannot move to another list.', 'conflict');
        }
        if ($this->findObjectInCalendar((int) $target->calendarid, $objectUri) !== null) {
            throw new ApiHttpException(409, 'The target list already holds a task with this id.', 'alreadyExists');
        }

        return $target;
    }

    /**
     * @return array{ok: true}
     */
    public function delete(
        string $username,
        string $taskId,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        $located = $this->locator->find($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This task list is read-only.');

        $instance = $located['instance'];
        $vtodoUid = $located['vtodoUid'];
        $objectUri = (string) $located['object']->uri;
        $calendarIdPair = [(int) $instance->calendarid, (int) $instance->id];
        $davPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);
        $existingTask = $this->mapper->forViewer($username)->toTask($located['object'], $this->taskListUriForInstance($instance), $vtodoUid);

        // Under the live-text core's lock the precondition and the remaining
        // ICS come from the locked row, so a text save that landed after the
        // lookup is neither overwritten nor deleted past a stale If-Match.
        $fileRemains = $this->textCore->locked(
            $this->textFields->forComponent($vtodoUid),
            $located['object'],
            'Task not found.',
            function (CalendarObject $object, ?Model $state) use (
                $ifMatch, $ifUnmodifiedSince, $requirePrecondition, $vtodoUid, $calendarIdPair, $objectUri,
            ): bool {
                $this->assertObjectPreconditions($object, $ifMatch, $ifUnmodifiedSince, $requirePrecondition);

                if ($vtodoUid !== null) {
                    $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                    $remaining = $this->mapper->removeVtodoFromIcs($raw, $vtodoUid);
                    if ($remaining !== null) {
                        $this->backends->calBackend()->updateCalendarObject($calendarIdPair, $objectUri, $remaining);
                        $state?->delete();

                        return true;
                    }
                }
                $this->backends->calBackend()->deleteCalendarObject($calendarIdPair, $objectUri);

                return false;
            },
        );

        $this->searchIndexSync->sync(
            'tasks',
            $fileRemains
                ? fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath)
                : fn () => $this->searchIndexer->deleteDavPath($davPath),
            $davPath,
            $username,
        );
        $this->changeReactions->afterWrite($username, $instance, $existingTask, null);

        return ['ok' => true];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function resolveTaskListFromPayload(string $username, array $payload): CalendarInstance
    {
        $taskListIds = $payload['taskListIds'] ?? null;
        if (! is_array($taskListIds) || $taskListIds === []) {
            throw new ApiHttpException(400, 'taskListIds is required.', 'bad_request');
        }

        $listUri = null;
        foreach ($taskListIds as $id => $enabled) {
            if ($enabled === true) {
                $listUri = (string) $id;
                break;
            }
        }

        if ($listUri === null || $listUri === '') {
            throw new ApiHttpException(400, 'taskListIds is required.', 'bad_request');
        }

        $instance = $this->taskLists->findAccessibleTaskList($username, $listUri);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }

        return $instance;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>|null  $existingTask
     * @return array<string, mixed>
     */
    private function normalizeTaskPayload(array $payload, ?array $existingTask = null): array
    {
        $task = $payload;
        unset($task['id'], $task['taskListId'], $task['taskListIds'], $task['@type']);

        if (! isset($task['uid']) || ! is_string($task['uid']) || trim($task['uid']) === '') {
            $task['uid'] = $existingTask['uid'] ?? 'urn:uuid:'.Str::uuid()->toString();
        }
        if (! isset($task['isDraft'])) {
            $task['isDraft'] = false;
        }
        if (! isset($task['sortOrder'])) {
            $task['sortOrder'] = 0;
        }

        return $task;
    }

    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     */
    private function notifyStatusChanged(
        string $actor,
        CalendarInstance $instance,
        array $before,
        array $after,
    ): void {
        $from = is_string($before['workflowStatus'] ?? null) ? $before['workflowStatus'] : null;
        $to = is_string($after['workflowStatus'] ?? null) ? $after['workflowStatus'] : null;
        if ($to === null || $from === $to) {
            return;
        }
        $owners = TaskListOwnerUsernames::of($instance);
        if ($owners === []) {
            return;
        }
        $summary = trim((string) ($after['title'] ?? $after['summary'] ?? ''));
        $taskId = (string) ($after['id'] ?? '');
        $taskListId = $this->taskLists->apiIdForInstance($instance);
        $this->eventDispatch->fireMutation(
            $actor,
            'tasks',
            TaskStatusChangedNotify::ACTION,
            'tasks/'.$taskId,
            TaskStatusChangedNotify::eventData(
                TaskStatusChangedNotify::actorLabel($actor),
                $summary,
                $taskId,
                $from,
                $to,
                $taskListId,
                $owners,
            ),
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function allocateObjectUri(int $calendarId, array $payload): string
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = TaskMapper::generateObjectUri($payload);
            if ($this->findObjectInCalendar($calendarId, $candidate) === null) {
                return $candidate;
            }
        }

        throw new ApiHttpException(500, 'Could not allocate task id.', 'server_error');
    }

    private function findObjectInCalendar(int $calendarId, string $objectUri): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uri', $objectUri)
            ->first();
    }

    private function calendarDavPath(string $username, string $calendarUri, string $objectUri): string
    {
        return 'calendars/'.$username.'/'.$calendarUri.'/'.$objectUri;
    }

    private function taskListUriForInstance(CalendarInstance $instance): string
    {
        return $this->taskLists->apiIdForInstance($instance);
    }

    private function assertObjectPreconditions(
        CalendarObject $object,
        ?string $ifMatch,
        ?string $ifUnmodifiedSince,
        bool $requirePrecondition = true,
    ): void {
        OptimisticConcurrency::assertPreconditions(
            $ifMatch,
            $ifUnmodifiedSince,
            is_string($object->etag) ? $object->etag : null,
            (int) ($object->lastmodified ?? 0),
            $requirePrecondition,
        );
    }

    /**
     * Applies the edit to the stored iCalendar in place, so data the task model
     * cannot hold survives (#1392). The baseline is the stored task as read,
     * normalized the same way as the payload.
     *
     * @param  array<string, mixed>  $taskPayload
     * @param  array<string, mixed>  $existingTask
     */
    private function updatedIcs(string $raw, array $taskPayload, array $existingTask, ?string $vtodoUid): string
    {
        $baseline = $this->normalizeTaskPayload($existingTask, $existingTask);
        $baseline['id'] = $taskPayload['id'];
        $baseline['taskListId'] = $taskPayload['taskListId'];
        $baseline['uid'] = $taskPayload['uid'];
        $taskPayload = self::withSequenceBump($baseline, $taskPayload);

        return ICalendarInPlacePatcher::patch(
            $raw,
            $this->renderTaskUpdate($raw, $baseline, $vtodoUid),
            $this->renderTaskUpdate($raw, $taskPayload, $vtodoUid),
        );
    }

    /**
     * @param  array<string, mixed>  $taskPayload
     */
    private function renderTaskUpdate(string $raw, array $taskPayload, ?string $vtodoUid): string
    {
        return $vtodoUid !== null
            ? $this->mapper->mergeIntoIcs($raw, $taskPayload, $vtodoUid)
            : $this->mapper->toIcs($taskPayload);
    }

    /**
     * RFC 5545 §3.8.7.4: a significant change (start, due, duration or
     * recurrence) increments SEQUENCE, so clients see the task changed (RT-T2, #1403).
     *
     * @param  array<string, mixed>  $baseline
     * @param  array<string, mixed>  $taskPayload
     * @return array<string, mixed>
     */
    private static function withSequenceBump(array $baseline, array $taskPayload): array
    {
        if (array_key_exists('sequence', $taskPayload) && ($taskPayload['sequence'] ?? null) !== ($baseline['sequence'] ?? null)) {
            return $taskPayload;
        }
        foreach (['start', 'due', 'estimatedDuration', 'duration', 'timeZone', 'showWithoutTime', 'recurrenceRules', 'excludedRecurrenceDates', 'recurrenceOverrides'] as $field) {
            if (($baseline[$field] ?? null) !== ($taskPayload[$field] ?? null)) {
                $taskPayload['sequence'] = (is_int($baseline['sequence'] ?? null) ? $baseline['sequence'] : 0) + 1;

                return $taskPayload;
            }
        }

        return $taskPayload;
    }
}
