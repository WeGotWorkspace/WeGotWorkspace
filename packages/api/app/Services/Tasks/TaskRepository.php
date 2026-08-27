<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Services\Tasks\Conversion\ConversionSupport;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;

final class TaskRepository
{
    public function __construct(
        private readonly TaskMapper $mapper,
        private readonly TaskListRepository $taskLists,
        private readonly SearchIndexerService $searchIndexer,
        private readonly DriveGroupResolver $groups,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly BestEffortSearchIndexSync $searchIndexSync = new BestEffortSearchIndexSync,
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username, string $taskListId): array
    {
        $instance = $this->taskLists->findAccessibleTaskList($username, $taskListId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }

        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VTODO')
            ->orderBy('uri')
            ->get();

        $tasks = [];
        foreach ($objects as $object) {
            foreach ($this->mapper->toTasks($object, $taskListId) as $task) {
                $tasks[] = $task;
            }
        }

        return ['list' => $tasks];
    }

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
        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VTODO')
            ->orderBy('uri')
            ->get();

        $ids = [];
        $total = 0;
        foreach ($objects as $object) {
            foreach ($this->mapper->toTasks($object, $taskListId) as $task) {
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
        }

        return ['ids' => $ids, 'total' => $total];
    }

    public function show(string $username, string $taskId): array
    {
        $located = $this->findOwnedTask($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $task = $this->mapper->toTask(
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
        $taskPayload = $this->normalizeTaskPayload($payload);
        $objectUri = $this->allocateObjectUri((int) $instance->calendarid, $taskPayload);
        $ics = $this->mapper->toIcs($taskPayload);

        $this->calBackend()->createCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            $objectUri,
            $ics,
        );
        $davPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);
        $this->searchIndexSync->sync(
            'tasks',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $object = $this->findObjectInCalendar((int) $instance->calendarid, $objectUri);
        if ($object === null) {
            throw new ApiHttpException(500, 'Could not load created task.', 'server_error');
        }

        $taskListId = $this->taskListUriForInstance($instance);
        $task = $this->mapper->toTask($object, $taskListId);
        if ($task === null) {
            throw new ApiHttpException(500, 'Could not load created task.', 'server_error');
        }

        return $task;
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
    ): array {
        $located = $this->findOwnedTask($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This task list is read-only.');
        $this->assertObjectPreconditions($located['object'], $ifMatch, $ifUnmodifiedSince);

        $instance = $located['instance'];
        $object = $located['object'];
        $objectUri = (string) $object->uri;
        $taskListId = $this->taskListUriForInstance($instance);
        $existingTask = $this->mapper->toTask($object, $taskListId, $located['vtodoUid']);
        if ($existingTask === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $taskPayload = $this->normalizeTaskPayload($payload, $existingTask);
        $taskPayload['id'] = $existingTask['id'];
        $taskPayload['taskListId'] = $this->taskLists->apiIdForInstance($instance);
        $taskPayload['uid'] = $existingTask['uid'];

        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $ics = $located['vtodoUid'] !== null
            ? $this->mapper->mergeIntoIcs($raw, $taskPayload, $located['vtodoUid'])
            : $this->mapper->toIcs($taskPayload);

        $this->calBackend()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            $objectUri,
            $ics,
        );
        $davPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);
        $this->searchIndexSync->sync(
            'tasks',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $updated = $this->findObjectInCalendar((int) $instance->calendarid, $objectUri);
        if ($updated === null) {
            throw new ApiHttpException(500, 'Could not load updated task.', 'server_error');
        }

        $task = $this->mapper->toTask($updated, $taskListId, $located['vtodoUid']);
        if ($task === null) {
            throw new ApiHttpException(500, 'Could not load updated task.', 'server_error');
        }

        return $task;
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
    ): array {
        $located = $this->findOwnedTask($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This task list is read-only.');
        $this->assertObjectPreconditions($located['object'], $ifMatch, $ifUnmodifiedSince);

        $instance = $located['instance'];
        $object = $located['object'];
        $objectUri = (string) $object->uri;
        $taskListId = $this->taskListUriForInstance($instance);
        $existingTask = $this->mapper->toTask($object, $taskListId, $located['vtodoUid']);
        if ($existingTask === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $merged = ConversionSupport::deepMergeTaskPatch($existingTask, $patch);
        $taskPayload = $this->normalizeTaskPayload($merged, $existingTask);
        $taskPayload['id'] = $existingTask['id'];
        $taskPayload['taskListId'] = $this->taskLists->apiIdForInstance($instance);
        $taskPayload['uid'] = $existingTask['uid'];

        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $ics = $located['vtodoUid'] !== null
            ? $this->mapper->mergeIntoIcs($raw, $taskPayload, $located['vtodoUid'])
            : $this->mapper->toIcs($taskPayload);

        $this->calBackend()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            $objectUri,
            $ics,
        );
        $davPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);
        $this->searchIndexSync->sync(
            'tasks',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );

        $updated = $this->findObjectInCalendar((int) $instance->calendarid, $objectUri);
        if ($updated === null) {
            throw new ApiHttpException(500, 'Could not load patched task.', 'server_error');
        }

        $task = $this->mapper->toTask($updated, $taskListId, $located['vtodoUid']);
        if ($task === null) {
            throw new ApiHttpException(500, 'Could not load patched task.', 'server_error');
        }

        return $task;
    }

    /**
     * @return array{ok: true}
     */
    public function delete(
        string $username,
        string $taskId,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        $located = $this->findOwnedTask($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        $this->collectionAccess->assertCollectionWritable($located['instance'], 'This task list is read-only.');
        $this->assertObjectPreconditions($located['object'], $ifMatch, $ifUnmodifiedSince);

        $instance = $located['instance'];
        $object = $located['object'];
        $objectUri = (string) $object->uri;
        $calendarIdPair = [(int) $instance->calendarid, (int) $instance->id];
        $davPath = $this->calendarDavPath($username, (string) $instance->uri, $objectUri);

        if ($located['vtodoUid'] !== null) {
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            $remaining = $this->mapper->removeVtodoFromIcs($raw, $located['vtodoUid']);
            if ($remaining === null) {
                $this->calBackend()->deleteCalendarObject($calendarIdPair, $objectUri);
                $this->searchIndexSync->sync(
                    'tasks',
                    fn () => $this->searchIndexer->deleteDavPath($davPath),
                    $davPath,
                    $username,
                );
            } else {
                $this->calBackend()->updateCalendarObject($calendarIdPair, $objectUri, $remaining);
                $this->searchIndexSync->sync(
                    'tasks',
                    fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                    $davPath,
                    $username,
                );
            }
        } else {
            $this->calBackend()->deleteCalendarObject($calendarIdPair, $objectUri);
            $this->searchIndexSync->sync(
                'tasks',
                fn () => $this->searchIndexer->deleteDavPath($davPath),
                $davPath,
                $username,
            );
        }

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

    /**
     * @return array{
     *     object: CalendarObject,
     *     instance: CalendarInstance,
     *     taskListUri: string,
     *     vtodoUid: string|null
     * }|null
     */
    private function findOwnedTask(string $username, string $taskId): ?array
    {
        $parsed = IcsJmapTaskConverter::parseTaskId($taskId);
        $objectUri = $parsed['objectUri'];
        $vtodoUid = $parsed['vtodoUid'];

        $rows = CalendarObject::query()
            ->from('calendarobjects as o')
            ->join('calendars as c', 'c.id', '=', 'o.calendarid')
            ->join('calendarinstances as i', 'i.calendarid', '=', 'c.id')
            ->where('o.uri', $objectUri)
            ->whereIn('i.principaluri', $this->accessiblePrincipalUris($username))
            ->where('c.components', 'like', '%VTODO%')
            ->select([
                'o.id',
                'i.id as instance_id',
            ])
            ->get();

        if ($rows->isEmpty()) {
            return null;
        }

        $object = CalendarObject::query()->find((int) $rows->first()->id);
        if ($object === null) {
            return null;
        }

        $instances = CalendarInstance::query()
            ->whereIn('id', $rows->pluck('instance_id')->all())
            ->get();
        $instance = $this->collectionAccess->preferHighestAccessPerCalendar($instances)->first();
        if ($instance === null) {
            return null;
        }

        return [
            'object' => $object,
            'instance' => $instance,
            'taskListUri' => $this->taskLists->apiIdForInstance($instance),
            'vtodoUid' => $vtodoUid,
        ];
    }

    /**
     * @return list<string>
     */
    private function accessiblePrincipalUris(string $username): array
    {
        $uris = [$this->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $uris[] = AdminConstants::GROUP_PREFIX.$slug;
        }

        return $uris;
    }

    private function findOwnedInstance(string $username, string $taskListId): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->where('uri', $taskListId)
            ->whereHas('calendar', fn ($query) => $query->supportsVtodo())
            ->first();
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

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private function assertObjectPreconditions(CalendarObject $object, ?string $ifMatch, ?string $ifUnmodifiedSince): void
    {
        OptimisticConcurrency::assertPreconditions(
            $ifMatch,
            $ifUnmodifiedSince,
            is_string($object->etag) ? $object->etag : null,
            (int) ($object->lastmodified ?? 0),
        );
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
