<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Events\EventDispatch;
use App\Exceptions\ApiHttpException;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Notify\CollectionSharedNotify;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Plugin as CalDAVPlugin;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\PropPatch;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

final class CalendarRepository
{
    /** Sabre CalDAV PDO maps this Apple property onto `calendarinstances.calendarcolor`. */
    private const CALENDAR_COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    /** @var array<string, array<string, string>> */
    private array $subscriptionIdsByUser = [];

    /** @var array<string, list<array{id: string, username: string}>>|null */
    private ?array $subscriptionRowsByUri = null;

    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
        private readonly DriveGroupResolver $groups,
        private readonly CalendarShareInvites $shareInvites,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly WgwCalendarBackendFactory $backends,
        private readonly CalDavCollections $collections,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /** @return array<string, mixed> */
    public function list(string $username): array
    {
        $calendars = $this->accessibleVeventInstances($username)
            ->map(function (CalendarInstance $instance) use ($username): array {
                $groupSlug = $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

                return $this->mapCalendar($username, $instance, $groupSlug);
            })
            ->values()
            ->all();

        return ['list' => $calendars];
    }

    /** @return array<string, mixed> */
    public function show(string $username, string $calendarId): array
    {
        $instance = $this->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        $groupSlug = CalendarCollectionUris::parseGroupCalendarApiId($calendarId)
            ?? $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapCalendar($username, $instance, $groupSlug);
    }

    /** @param array<string, mixed> $payload
     * @return array<string, mixed> */
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
                throw new ApiHttpException(403, 'Not a member of this group.', 'forbidden');
            }
            $principalUri = AdminConstants::GROUP_PREFIX.$groupSlug;
            $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
            if ($group === null) {
                throw new ApiHttpException(404, 'Group not found.', 'not_found');
            }
            $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
                (string) $group->uri,
                (string) ($group->displayname ?? $groupSlug),
            );
        } else {
            $principalUri = $this->collections->principalUri($username);
        }

        $uri = $this->allocateCalendarUri(
            $principalUri,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
            $name,
            $groupSlug,
        );

        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT']),
        ];

        if (array_key_exists('description', $payload)) {
            $description = $payload['description'];
            $properties['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($description) ? $description : null;
        }
        if (array_key_exists('color', $payload) && is_string($payload['color']) && trim($payload['color']) !== '') {
            $properties[self::CALENDAR_COLOR_PROPERTY] = trim($payload['color']);
        }
        if (array_key_exists('timeZone', $payload) && is_string($payload['timeZone']) && trim($payload['timeZone']) !== '') {
            $properties['{'.CalDAVPlugin::NS_CALDAV.'}calendar-timezone'] = trim($payload['timeZone']);
        }

        try {
            $this->backends->make()->createCollection(CollectionKind::EventCalendar, $principalUri, $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findCalendarInstance($principalUri, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created calendar.', 'server_error');
        }

        if (array_key_exists('shareWith', $payload)) {
            $this->notifyCollectionShare($username, $instance, $groupSlug, $payload['shareWith']);
            $instance->refresh();
        }

        return $this->mapCalendar($username, $instance, $groupSlug);
    }

    /** @param array<string, mixed> $payload
     * @return array<string, mixed> */
    public function update(string $username, string $calendarId, array $payload): array
    {
        return DB::connection('wgw')->transaction(function () use ($username, $calendarId, $payload): array {
            $this->collectionAccess->restoreWhenSubscribing($username, CollectionKind::EventCalendar, $calendarId, $payload);
            $resolved = $this->resolveWritableCalendar($username, $calendarId);
            if ($resolved === null) {
                throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
            }
            [$instance, $groupSlug] = $resolved;

            $this->collectionAccess->assertShareePatchAllowed(
                $instance,
                $payload,
                ['description', 'timeZone', 'shareWith', 'groupSlug'],
                'Sharees can only change their own calendar name and color.',
            );

            $mutations = $this->collectionAccess->propertyMutations($payload);
            if (array_key_exists('timeZone', $payload)) {
                $timeZone = $payload['timeZone'];
                $mutations['{'.CalDAVPlugin::NS_CALDAV.'}calendar-timezone'] = is_string($timeZone) && trim($timeZone) !== '' ? trim($timeZone) : null;
            }

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

            return $this->mapCalendar($username, $instance, $groupSlug);
        });
    }

    /** @param array<string, mixed> $options
     * @return array<string, mixed> */
    public function delete(string $username, string $calendarId, array $options = []): array
    {
        $resolved = $this->resolveWritableCalendar($username, $calendarId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;

        if ($this->collectionAccess->dismissIfSharee($username, $instance)) {
            return ['ok' => true];
        }
        if ((string) $instance->uri === CalendarCollectionUris::EVENT_DEFAULT) {
            throw new ApiHttpException(403, 'The default calendar cannot be deleted.', 'forbidden');
        }
        if ($this->isProvisionedGroupCalendar($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'The group calendar cannot be deleted.', 'forbidden');
        }
        $isSubscription = $this->subscriptionIdForInstance($instance, $groupSlug) !== null;
        if (($options['subscriptionDelete'] ?? false) !== true || ! $isSubscription) {
            $this->collectionAccess->assertGroupOwnedDeleteAllowed($username, $instance);
        }
        $removeContents = (bool) ($options['onDestroyRemoveContents'] ?? false);
        if ($instance->objects()->where('componenttype', 'VEVENT')->exists() && ! $removeContents && ! $isSubscription) {
            throw new ApiHttpException(409, 'Calendar contains events.', 'calendarHasContents');
        }
        $this->backends->calBackend()->deleteCalendar($this->collections->backendId($instance));
        $this->forgetCalendarSideTables($username, (string) $instance->uri);

        return ['ok' => true];
    }

    public function deleteIncludingContents(string $username, string $calendarId): void
    {
        // create() maps the calendar before the subscription row exists.
        $this->subscriptionRowsByUri = null;
        $this->delete($username, $calendarId, ['onDestroyRemoveContents' => true, 'subscriptionDelete' => true]);
    }

    public function isSubscriptionCalendar(string $username, string $calendarId): bool
    {
        if (isset($this->subscriptionIdMap($username)[$calendarId])) {
            return true;
        }

        $instance = $this->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            return false;
        }

        $groupSlug = CalendarCollectionUris::parseGroupCalendarApiId($calendarId)
            ?? $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->subscriptionIdForInstance($instance, $groupSlug) !== null;
    }

    public function findPublishableCalendar(string $username, string $calendarId): CalendarInstance
    {
        $resolved = $this->resolveWritableCalendar($username, $calendarId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;
        if (! $this->shareInvites->canShare($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'Only calendar administrators can publish a feed.', 'forbidden');
        }

        return $instance;
    }

    public function instanceMayWrite(CalendarInstance $instance): bool
    {
        return (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)
            !== SharingPlugin::ACCESS_READ;
    }

    public function userMayWriteEventsOwnedBy(string $username, string $ownerPrincipalUri): bool
    {
        if ($username === '' || $ownerPrincipalUri === '') {
            return false;
        }

        $ownedCalendarIds = $this->ownedVeventCalendarIds($ownerPrincipalUri);
        $groupSlug = $this->collections->groupSlugFromPrincipalUri($ownerPrincipalUri);
        $isGroupMember = $groupSlug !== null
            && in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true);

        if ($ownedCalendarIds === []) {
            return $isGroupMember;
        }
        if ($isGroupMember) {
            return true;
        }

        return CalendarInstance::query()
            ->where('principaluri', $this->collections->principalUri($username))
            ->whereIn('calendarid', $ownedCalendarIds)
            ->get()
            ->contains(fn (CalendarInstance $instance): bool => $this->instanceMayWrite($instance));
    }

    public function findAccessibleCalendar(string $username, string $calendarId): ?CalendarInstance
    {
        $groupSlug = CalendarCollectionUris::parseGroupCalendarApiId($calendarId);
        if ($groupSlug !== null) {
            if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
                return null;
            }

            return $this->ensureGroupCalendarInstance($groupSlug);
        }

        return $this->collectionAccess->findReachable(
            $username,
            fn (string $principalUri): ?CalendarInstance => $this->findCalendarInstance($principalUri, $calendarId),
        );
    }

    public function apiIdForInstance(CalendarInstance $instance): string
    {
        $groupSlug = $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);
        if ($groupSlug !== null) {
            $uri = (string) $instance->uri;
            if ($uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug)) {
                return CalendarCollectionUris::groupCalendarApiId($groupSlug);
            }
        }

        return (string) $instance->uri;
    }

    /**
     * @return list<string>
     */
    public function accessiblePrincipalUris(string $username): array
    {
        $uris = [$this->collections->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $uris[] = AdminConstants::GROUP_PREFIX.$slug;
        }

        return $uris;
    }

    public function assertEventWritable(CalendarInstance $instance): void
    {
        $this->collectionAccess->assertCollectionWritable($instance, 'This calendar is read-only.');
    }

    /**
     * @return Collection<int, CalendarInstance>
     */
    public function accessibleVeventInstances(string $username)
    {
        return $this->collectionAccess->accessibleInstances($username, CollectionKind::EventCalendar);
    }

    /**
     * @return array{0: CalendarInstance, 1: ?string}|null
     */
    private function resolveWritableCalendar(string $username, string $calendarId): ?array
    {
        $instance = $this->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            return null;
        }

        $groupSlug = CalendarCollectionUris::parseGroupCalendarApiId($calendarId)
            ?? $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return [$instance, $groupSlug];
    }

    private function isProvisionedGroupCalendar(CalendarInstance $instance, ?string $groupSlug): bool
    {
        return $groupSlug !== null
            && (string) $instance->uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug);
    }

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
        $existing = $this->findCalendarInstance($principalUri, (string) $instance->uri);
        if ($existing !== null && (int) $existing->id !== (int) $instance->id) {
            throw new ApiHttpException(409, 'Calendar id already exists.', 'alreadyExists');
        }

        $instance->principaluri = $principalUri;
        $instance->save();
    }

    private function assertOwnerTransferAllowed(CalendarInstance $instance, ?string $currentGroupSlug): void
    {
        if ($this->shareInvites->isSharee($instance)) {
            throw new ApiHttpException(403, 'Sharees cannot change calendar owner.', 'forbidden');
        }
        if (! $this->shareInvites->canShare($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'Only calendar administrators can change owner.', 'forbidden');
        }
        $this->subscriptionIdsByUser = [];
        $this->subscriptionRowsByUri = null;
        if ($this->subscriptionIdForInstance($instance, $currentGroupSlug) !== null) {
            throw new ApiHttpException(403, 'Subscribed calendars cannot change owner.', 'forbidden');
        }
        if ((string) $instance->uri === CalendarCollectionUris::EVENT_DEFAULT) {
            throw new ApiHttpException(403, 'The default calendar cannot change owner.', 'forbidden');
        }
        if ($this->isProvisionedGroupCalendar($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'The group calendar cannot change owner.', 'forbidden');
        }
    }

    private function principalUriForOwnerScope(
        string $username,
        CalendarInstance $instance,
        ?string $groupSlug,
    ): string {
        $principalUri = $this->collections->ownerScopePrincipalUri($username, $groupSlug);
        if ($groupSlug !== null && (string) $instance->uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug)) {
            throw new ApiHttpException(409, 'Calendar id already exists.', 'alreadyExists');
        }

        return $principalUri;
    }

    private function allocateCalendarUri(string $principalUri, ?string $requestedId, string $name, ?string $groupSlug): string
    {
        if ($requestedId !== null && $requestedId !== '') {
            if (
                $requestedId === CalendarCollectionUris::EVENT_DEFAULT
                || CalendarCollectionUris::parseGroupCalendarApiId($requestedId) !== null
                || $this->findCalendarInstance($principalUri, $requestedId) !== null
            ) {
                throw new ApiHttpException(409, 'Calendar id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }

        $base = Str::slug($name, '-') ?: 'calendar';
        if (str_starts_with($base, 'group-')) {
            $base = 'calendar-'.substr($base, strlen('group-'));
        }
        if (in_array($base, CalendarCollectionUris::reservedEventUris(), true)) {
            $base = 'calendar';
        }
        if ($groupSlug !== null && $base === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug)) {
            $base = 'calendar';
        }
        $candidate = $base;
        $suffix = 2;
        while ($this->findCalendarInstance($principalUri, $candidate) !== null) {
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
            $username,
        );
        if ($added === []) {
            return;
        }
        $grants = $this->shareInvites->shareWithForOwner($instance, $groupSlug) ?? [];
        $mapped = $this->mapCalendar($username, $instance, $groupSlug);
        $name = (string) ($mapped['name'] ?? $mapped['id'] ?? 'calendar');
        $id = (string) ($mapped['id'] ?? $instance->uri);
        foreach ($added as $sharee) {
            $grant = $grants[$sharee] ?? null;
            $access = is_array($grant) && $grant['mayWrite'] === true ? 'write' : 'read';
            $this->eventDispatch->fireMutation(
                $username,
                'calendar',
                CollectionSharedNotify::CALENDAR_ACTION,
                'calendars/'.$id,
                CollectionSharedNotify::eventData(
                    'calendar',
                    CollectionSharedNotify::actorLabel($username),
                    $name,
                    $id,
                    $access,
                    [$sharee],
                ),
            );
        }
    }

    /** @return array<string, mixed> */
    private function mapCalendar(string $username, CalendarInstance $instance, ?string $groupSlug = null): array
    {
        $uri = (string) $instance->uri;
        $name = trim((string) ($instance->displayname ?? ''));
        if ($name === '') {
            $name = $uri;
        }

        $isGroup = $groupSlug !== null;
        $isProvisionedGroup = $this->isProvisionedGroupCalendar($instance, $groupSlug);
        $subscriptionId = $this->subscriptionIdForInstance($instance, $groupSlug);
        $mayShare = $this->shareInvites->canShare($instance, $groupSlug);
        $groupMayDelete = $this->collectionAccess->mayDeleteGroupOwned($username, $instance);
        $rights = match ((int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)) {
            SharingPlugin::ACCESS_READ => ['mayRead' => true, 'mayWrite' => false, 'mayShare' => false, 'mayDelete' => true],
            SharingPlugin::ACCESS_READWRITE => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => true],
            default => [
                'mayRead' => true,
                'mayWrite' => true,
                'mayShare' => $mayShare,
                'mayDelete' => $groupMayDelete && ! $isProvisionedGroup && $uri !== CalendarCollectionUris::EVENT_DEFAULT,
            ],
        };
        if ($subscriptionId !== null) {
            $rights = [
                'mayRead' => true,
                'mayWrite' => false,
                'mayShare' => false,
                'mayDelete' => true,
            ];
        }

        return [
            'id' => $isProvisionedGroup && is_string($groupSlug) ? CalendarCollectionUris::groupCalendarApiId($groupSlug) : $uri,
            'name' => $name,
            'description' => is_string($instance->description) && trim($instance->description) !== '' ? trim($instance->description) : null,
            'timeZone' => is_string($instance->timezone) && trim($instance->timezone) !== '' ? trim($instance->timezone) : null,
            'color' => is_string($instance->calendarcolor) && trim($instance->calendarcolor) !== '' ? trim($instance->calendarcolor) : null,
            'sortOrder' => (int) ($instance->calendarorder ?? 0),
            'isDefault' => ! $isGroup && $uri === CalendarCollectionUris::EVENT_DEFAULT,
            'isSubscribed' => true,
            'subscriptionId' => $subscriptionId,
            'scope' => $isGroup ? 'group' : 'personal',
            'groupSlug' => $isGroup ? $groupSlug : null,
            'shareWith' => $this->shareInvites->shareWithForOwner($instance, $groupSlug),
            'myRights' => $rights,
        ];
    }

    private function subscriptionIdForInstance(CalendarInstance $instance, ?string $groupSlug = null): ?string
    {
        $uri = (string) $instance->uri;
        $owner = $this->usernameFromPrincipalUri((string) $instance->principaluri);
        if ($owner !== null) {
            return $this->subscriptionIdMap($owner)[$uri] ?? null;
        }

        $groupSlug ??= $this->collections->groupSlugFromPrincipalUri((string) $instance->principaluri);
        if ($groupSlug === null) {
            return null;
        }

        return $this->sharedGroupSubscriptionId($uri);
    }

    private function sharedGroupSubscriptionId(string $calendarUri): ?string
    {
        foreach ($this->subscriptionRowsForUri($calendarUri) as $row) {
            if ($this->findCalendarInstance($this->collections->principalUri($row['username']), $calendarUri) === null) {
                return $row['id'];
            }
        }

        return null;
    }

    /** @return list<array{id: string, username: string}> */
    private function subscriptionRowsForUri(string $calendarUri): array
    {
        if ($this->subscriptionRowsByUri === null) {
            $this->subscriptionRowsByUri = [];
            foreach (CalendarSubscription::query()->get(['id', 'username', 'calendar_uri']) as $row) {
                $this->subscriptionRowsByUri[(string) $row->calendar_uri][] = [
                    'id' => (string) $row->id,
                    'username' => (string) $row->username,
                ];
            }
        }

        return $this->subscriptionRowsByUri[$calendarUri] ?? [];
    }

    /**
     * @return array<string, string>
     */
    private function subscriptionIdMap(string $username): array
    {
        if (! array_key_exists($username, $this->subscriptionIdsByUser)) {
            $this->subscriptionIdsByUser[$username] = CalendarSubscription::query()
                ->where('username', $username)
                ->pluck('id', 'calendar_uri')
                ->all();
        }

        return $this->subscriptionIdsByUser[$username];
    }

    /** Feed tokens need no cleanup here: they cascade with the `calendars` row. */
    private function forgetCalendarSideTables(string $username, string $calendarUri): void
    {
        CalendarSubscription::query()
            ->where('username', $username)
            ->where('calendar_uri', $calendarUri)
            ->delete();
        unset($this->subscriptionIdsByUser[$username]);
        $this->subscriptionRowsByUri = null;
    }

    private function usernameFromPrincipalUri(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, 'principals/')) {
            return null;
        }
        $username = substr($principalUri, strlen('principals/'));
        if ($username === '' || str_starts_with($username, 'groups/')) {
            return null;
        }

        return $username;
    }

    /**
     * Event calendars match by component set (VEVENT), not by stored kind.
     *
     * @param  Builder<Calendar>  $query
     */
    private static function eventCalendars(Builder $query): void
    {
        $query->supportsVevent();
    }

    private function findCalendarInstance(string $principalUri, string $calendarUri): ?CalendarInstance
    {
        return $this->collections->findInstance($principalUri, $calendarUri, self::eventCalendars(...));
    }

    private function ensureGroupCalendarInstance(string $groupSlug): ?CalendarInstance
    {
        return $this->collections->findGroupInstance(
            $groupSlug,
            CalendarCollectionUris::groupCalendarCalDavUri($groupSlug),
            self::eventCalendars(...),
        );
    }

    /**
     * @return list<int>
     */
    private function ownedVeventCalendarIds(string $ownerPrincipalUri): array
    {
        return array_values(CalendarInstance::query()
            ->where('principaluri', $ownerPrincipalUri)
            ->where(function ($query): void {
                $query->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
                    ->orWhereNull('access');
            })
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->pluck('calendarid')->map(static fn (mixed $id): int => (int) $id)
            ->all());
    }
}
