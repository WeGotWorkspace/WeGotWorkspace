<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Events\EventDispatch;
use App\Exceptions\ApiHttpException;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalDavCollections;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarShareInvites;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Notify\CollectionSharedNotify;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Plugin as CalDAVPlugin;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\PropPatch;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

final class TaskListRepository
{
    private const CALENDAR_COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
        private readonly DriveGroupResolver $groups,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly CalendarShareInvites $shareInvites,
        private readonly WgwCalendarBackendFactory $backends,
        private readonly CalDavCollections $collections,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /** @return array<mixed> */
    public function list(string $username): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->collections->principalUri($username));

        $lists = $this->collectionAccess
            ->accessibleInstances($username, CollectionKind::TaskList)
            ->map(function (CalendarInstance $instance) use ($username): array {
                $groupSlug = $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

                return $this->mapTaskList($username, $instance, $groupSlug);
            })
            ->values()
            ->all();

        return ['list' => $lists];
    }

    /** @return array<mixed> */
    public function show(string $username, string $taskListId): array
    {
        $instance = $this->findAccessibleTaskList($username, $taskListId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }

        $groupSlug = CalendarCollectionUris::parseGroupTaskListApiId($taskListId)
            ?? $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapTaskList($username, $instance, $groupSlug);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<mixed>
     */
    public function create(string $username, array $payload): array
    {
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            throw new ApiHttpException(400, 'name is required.', 'bad_request');
        }

        $groupSlug = isset($payload['groupSlug']) && is_string($payload['groupSlug'])
            ? trim($payload['groupSlug'])
            : null;
        if ($groupSlug === '') {
            $groupSlug = null;
        }

        if ($groupSlug !== null) {
            if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
                throw new ApiHttpException(403, 'Not a member of this team.', 'forbidden');
            }
            $principalUri = AdminConstants::GROUP_PREFIX.$groupSlug;
            $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
            if ($group === null) {
                throw new ApiHttpException(404, 'Team not found.', 'not_found');
            }
            $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
                (string) $group->uri,
                (string) ($group->displayname ?? $groupSlug),
            );
        } else {
            $principalUri = $this->collections->principalUri($username);
        }

        $uri = $this->allocateTaskListUri(
            $principalUri,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
            $name,
        );
        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VTODO']),
        ];
        if (array_key_exists('description', $payload)) {
            $properties['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($payload['description']) ? $payload['description'] : null;
        }
        if (array_key_exists('color', $payload) && is_string($payload['color']) && trim($payload['color']) !== '') {
            $properties[self::CALENDAR_COLOR_PROPERTY] = trim($payload['color']);
        }

        try {
            $this->backends->make()->createCollection(CollectionKind::TaskList, $principalUri, $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findTaskListInstance($principalUri, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created task list.', 'server_error');
        }

        return $this->mapTaskList($username, $instance, $groupSlug);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<mixed>
     */
    public function update(string $username, string $taskListId, array $payload): array
    {
        return DB::connection('wgw')->transaction(function () use ($username, $taskListId, $payload): array {
            $this->collectionAccess->restoreWhenSubscribing($username, CollectionKind::TaskList, $taskListId, $payload);
            $resolved = $this->resolveWritableTaskList($username, $taskListId);
            if ($resolved === null) {
                throw new ApiHttpException(404, 'Task list not found.', 'not_found');
            }
            [$instance, $groupSlug] = $resolved;

            $this->collectionAccess->assertShareePatchAllowed(
                $instance,
                $payload,
                ['description', 'shareWith', 'groupSlug'],
                'Sharees can only change their own list name and color.',
            );

            $mutations = $this->collectionAccess->propertyMutations($payload);

            if ($mutations !== []) {
                $propPatch = new PropPatch($mutations);
                $this->backends->make()->updateCalendar($this->collections->backendId($instance), $propPatch);
                $propPatch->commit();
            }

            if (array_key_exists('shareWith', $payload)) {
                $this->notifyCollectionShare($username, $instance, $groupSlug, $payload['shareWith']);
            }

            if (array_key_exists('groupSlug', $payload)) {
                $this->transferOwner($username, $instance, $groupSlug, $payload['groupSlug']);
            }
            $this->collectionAccess->dismissWhenUnsubscribing($username, $instance, $payload);

            $instance->refresh();
            $groupSlug = $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

            return $this->mapTaskList($username, $instance, $groupSlug);
        });
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<mixed>
     */
    public function delete(string $username, string $taskListId, array $options = []): array
    {
        $resolved = $this->resolveWritableTaskList($username, $taskListId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;
        if ($this->collectionAccess->dismissIfSharee($username, $instance)) {
            return ['ok' => true];
        }
        if ((string) $instance->uri === InboxTaskListProvisioner::URI) {
            throw new ApiHttpException(403, 'The Inbox task list cannot be deleted.', 'forbidden');
        }
        if ($this->isProvisionedGroupTaskList($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'The team task list cannot be deleted.', 'forbidden');
        }
        $this->collectionAccess->assertGroupOwnedDeleteAllowed($username, $instance);
        if ($instance->objects()->where('componenttype', 'VTODO')->exists() && ! ($options['onDestroyRemoveContents'] ?? false)) {
            throw new ApiHttpException(409, 'Task list contains tasks.', 'taskListHasContents');
        }

        $this->backends->calBackend()->deleteCalendar($this->collections->backendId($instance));

        return ['ok' => true];
    }

    /** @return array<mixed> */
    public function changes(string $username, ?string $since): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->collections->principalUri($username));

        return $this->collections->changes(
            $this->collectionAccess->accessibleInstances($username, CollectionKind::TaskList),
            $since,
            fn (CalendarInstance $instance): string => $this->apiIdForInstance($instance),
        );
    }

    public function findAccessibleTaskList(string $username, string $taskListId): ?CalendarInstance
    {
        $groupSlug = CalendarCollectionUris::parseGroupTaskListApiId($taskListId);
        if ($groupSlug !== null) {
            if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
                return null;
            }

            return $this->ensureGroupTaskListInstance($groupSlug);
        }

        return $this->collectionAccess->findReachable(
            $username,
            fn (string $principalUri): ?CalendarInstance => $this->findTaskListInstance($principalUri, $taskListId),
        );
    }

    public function apiIdForInstance(CalendarInstance $instance): string
    {
        $groupSlug = $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);
        if ($groupSlug !== null) {
            $uri = (string) $instance->uri;
            if ($uri === CalendarCollectionUris::groupTaskListCalDavUri($groupSlug)) {
                return CalendarCollectionUris::groupTaskListApiId($groupSlug);
            }
        }

        return (string) $instance->uri;
    }

    /**
     * @return array{0: CalendarInstance, 1: ?string}|null
     */
    private function resolveWritableTaskList(string $username, string $taskListId): ?array
    {
        $instance = $this->findAccessibleTaskList($username, $taskListId);
        if ($instance === null) {
            return null;
        }

        $groupSlug = CalendarCollectionUris::parseGroupTaskListApiId($taskListId)
            ?? $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return [$instance, $groupSlug];
    }

    private function isProvisionedGroupTaskList(CalendarInstance $instance, ?string $groupSlug): bool
    {
        return $groupSlug !== null
            && (string) $instance->uri === CalendarCollectionUris::groupTaskListCalDavUri($groupSlug);
    }

    /**
     * Tasks stay on calendarid; sharee rows and shareWith grants are untouched.
     */
    private function transferOwner(
        string $username,
        CalendarInstance $instance,
        ?string $currentGroupSlug,
        mixed $requested,
    ): void {
        $this->assertOwnerTransferAllowed($instance, $currentGroupSlug);
        $newGroupSlug = $this->collections->normalizePatchGroupSlug($requested);
        if ($newGroupSlug === $currentGroupSlug) {
            return;
        }
        $this->collectionAccess->assertGroupOwnedTransferAllowed($username, $instance);
        $principalUri = $this->principalUriForOwnerScope($username, $instance, $newGroupSlug);
        $existing = $this->findTaskListInstance($principalUri, (string) $instance->uri);
        if ($existing !== null && (int) $existing->id !== (int) $instance->id) {
            throw new ApiHttpException(409, 'Task list id already exists.', 'alreadyExists');
        }

        $instance->principaluri = $principalUri;
        $instance->save();
    }

    private function assertOwnerTransferAllowed(CalendarInstance $instance, ?string $currentGroupSlug): void
    {
        if ($this->shareInvites->isSharee($instance)) {
            throw new ApiHttpException(403, 'Sharees cannot change list owner.', 'forbidden');
        }
        if (! $this->shareInvites->canShare($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'Only list administrators can change owner.', 'forbidden');
        }
        $uri = (string) $instance->uri;
        if ($uri === CalendarCollectionUris::TASK_INBOX || $uri === CalendarCollectionUris::LEGACY_TASK_INBOX) {
            throw new ApiHttpException(403, 'The inbox list cannot change owner.', 'forbidden');
        }
        if ($this->isProvisionedGroupTaskList($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'The team list cannot change owner.', 'forbidden');
        }
    }

    private function principalUriForOwnerScope(
        string $username,
        CalendarInstance $instance,
        ?string $groupSlug,
    ): string {
        $principalUri = $this->collections->ownerScopePrincipalUri($username, $groupSlug);
        if ($groupSlug !== null && (string) $instance->uri === CalendarCollectionUris::groupTaskListCalDavUri($groupSlug)) {
            throw new ApiHttpException(409, 'Task list id already exists.', 'alreadyExists');
        }

        return $principalUri;
    }

    private function allocateTaskListUri(string $principalUri, ?string $requestedId, string $name): string
    {
        if ($requestedId !== null && $requestedId !== '') {
            if (
                in_array($requestedId, CalendarCollectionUris::reservedTaskUriSlugs(), true)
                || $this->findTaskListInstance($principalUri, $requestedId) !== null
            ) {
                throw new ApiHttpException(409, 'Task list id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }
        $base = Str::slug($name, '-') ?: 'tasks';
        if (str_starts_with($base, 'group-')) {
            $base = 'project-'.substr($base, strlen('group-'));
        }
        if (in_array($base, CalendarCollectionUris::reservedTaskUriSlugs(), true)) {
            $base = 'project';
        }
        $candidate = $base;
        $suffix = 2;
        while ($this->findTaskListInstance($principalUri, $candidate) !== null) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    private function notifyCollectionShare(
        string $username,
        CalendarInstance $instance,
        ?string $groupSlug,
        mixed $shareWith,
    ): void {
        $added = CollectionSharedNotify::applyAndAddedUsernames(
            $this->shareInvites,
            $instance,
            $groupSlug,
            $shareWith,
        );
        if ($added === []) {
            return;
        }
        $grants = $this->shareInvites->shareWithForOwner($instance, $groupSlug) ?? [];
        $mapped = $this->mapTaskList($username, $instance, $groupSlug);
        $name = (string) ($mapped['name'] ?? $mapped['id'] ?? 'task list');
        $id = (string) ($mapped['id'] ?? $instance->uri);
        foreach ($added as $sharee) {
            $grant = $grants[$sharee] ?? null;
            $access = is_array($grant) && $grant['mayWrite'] === true ? 'write' : 'read';
            $this->eventDispatch->fireMutation(
                $username,
                'tasks',
                CollectionSharedNotify::TASKS_ACTION,
                'tasks/'.$id,
                CollectionSharedNotify::eventData(
                    'tasks',
                    CollectionSharedNotify::actorLabel($username),
                    $name,
                    $id,
                    $access,
                    [$sharee],
                ),
            );
        }
    }

    /** @return array<mixed> */
    private function mapTaskList(string $username, CalendarInstance $instance, ?string $groupSlug = null): array
    {
        $uri = (string) $instance->uri;
        $name = trim((string) ($instance->displayname ?? '')) ?: $uri;
        $isGroup = $groupSlug !== null;
        $isSharedGroupList = $this->isProvisionedGroupTaskList($instance, $groupSlug);
        $isSharee = $this->shareInvites->isSharee($instance);
        $isOwnedInbox = ! $isSharee && ! $isGroup && $uri === InboxTaskListProvisioner::URI;
        $mayShare = $this->shareInvites->canShare($instance, $groupSlug);
        $mayWrite = ! $this->shareInvites->isReadOnly($instance);
        $groupMayDelete = $this->collectionAccess->mayDeleteGroupOwned($username, $instance);
        $rights = match ((int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)) {
            SharingPlugin::ACCESS_READ => [
                'mayReadItems' => true,
                'mayWriteAll' => false,
                'mayWriteOwn' => false,
                'mayUpdatePrivate' => false,
                'mayRSVP' => false,
                'mayAdmin' => false,
                'mayDelete' => true,
                'mayShare' => false,
            ],
            SharingPlugin::ACCESS_READWRITE => [
                'mayReadItems' => true,
                'mayWriteAll' => true,
                'mayWriteOwn' => true,
                'mayUpdatePrivate' => true,
                'mayRSVP' => true,
                'mayAdmin' => false,
                'mayDelete' => true,
                'mayShare' => false,
            ],
            default => [
                'mayReadItems' => true,
                'mayWriteAll' => $mayWrite,
                'mayWriteOwn' => $mayWrite,
                'mayUpdatePrivate' => $mayWrite,
                'mayRSVP' => $mayWrite,
                'mayAdmin' => false,
                'mayDelete' => $groupMayDelete && ! $isSharedGroupList && $uri !== InboxTaskListProvisioner::URI,
                'mayShare' => $mayShare,
            ],
        };

        return [
            'id' => $isSharedGroupList && is_string($groupSlug) ? CalendarCollectionUris::groupTaskListApiId($groupSlug) : $uri,
            'role' => match (true) {
                $isOwnedInbox => 'inbox',
                $isSharedGroupList => 'group',
                $isSharee => null,
                $uri === CalendarCollectionUris::TASK_HOME => 'home',
                $uri === CalendarCollectionUris::TASK_WORK => 'work',
                default => null,
            },
            'name' => $name,
            'description' => is_string($instance->description) && trim($instance->description) !== '' ? trim($instance->description) : null,
            'color' => is_string($instance->calendarcolor) && trim($instance->calendarcolor) !== '' ? trim($instance->calendarcolor) : null,
            'sortOrder' => (int) ($instance->calendarorder ?? $instance->id ?? 0),
            'isDefault' => $isOwnedInbox,
            'isSubscribed' => true,
            'scope' => $isGroup ? 'group' : 'personal',
            'groupSlug' => $isGroup ? $groupSlug : null,
            'shareWith' => $this->shareInvites->shareWithForOwner($instance, $groupSlug),
            'isSharee' => $isSharee,
            'myRights' => $rights,
        ];
    }

    /** @param  Builder<Calendar>  $query */
    private static function taskLists(Builder $query): void
    {
        $query->ofKind(CollectionKind::TaskList);
    }

    private function findTaskListInstance(string $principalUri, string $taskListUri): ?CalendarInstance
    {
        return $this->collections->findInstance($principalUri, $taskListUri, self::taskLists(...));
    }

    private function ensureGroupTaskListInstance(string $groupSlug): ?CalendarInstance
    {
        return $this->collections->findGroupInstance(
            $groupSlug,
            CalendarCollectionUris::groupTaskListCalDavUri($groupSlug),
            self::taskLists(...),
        );
    }
}
