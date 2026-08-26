<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarFeedToken;
use App\Models\CalendarInstance;
use App\Models\CalendarSubscription;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
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
        private readonly CalendarShareVisibility $shareVisibility,
    ) {}

    public function list(string $username): array
    {
        $calendars = $this->accessibleVeventInstances($username)
            ->map(function (CalendarInstance $instance): array {
                $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

                return $this->mapCalendar($instance, $groupSlug);
            })
            ->values()
            ->all();

        return ['list' => $calendars];
    }

    public function show(string $username, string $calendarId): array
    {
        $instance = $this->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        $groupSlug = CalendarCollectionUris::parseGroupCalendarApiId($calendarId)
            ?? $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapCalendar($instance, $groupSlug);
    }

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
            $principalUri = $this->principalUri($username);
        }

        $uri = $this->allocateCalendarUri(
            $principalUri,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
            $name,
            $groupSlug,
        );

        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
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
            $this->calBackend()->createCalendar($principalUri, $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findCalendarInstance($principalUri, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created calendar.', 'server_error');
        }

        if (array_key_exists('shareWith', $payload)) {
            $this->shareInvites->apply($instance, $groupSlug, $payload['shareWith']);
            $instance->refresh();
        }

        return $this->mapCalendar($instance, $groupSlug);
    }

    public function update(string $username, string $calendarId, array $payload): array
    {
        $resolved = $this->resolveWritableCalendar($username, $calendarId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;

        if ($this->shareInvites->isSharee($instance)) {
            $disallowed = array_values(array_filter(
                ['description', 'timeZone', 'shareWith', 'groupSlug'],
                static fn (string $key): bool => array_key_exists($key, $payload),
            ));
            if ($disallowed !== []) {
                throw new ApiHttpException(403, 'Sharees can only change their own calendar name and color.', 'forbidden');
            }
        }

        $mutations = [];
        if (array_key_exists('name', $payload)) {
            $name = trim((string) $payload['name']);
            if ($name === '') {
                throw new ApiHttpException(400, 'name must not be empty.', 'invalidProperties');
            }
            $mutations['{DAV:}displayname'] = $name;
        }
        if (array_key_exists('description', $payload)) {
            $description = $payload['description'];
            $mutations['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($description) ? $description : null;
        }
        if (array_key_exists('color', $payload)) {
            $color = $payload['color'];
            $mutations[self::CALENDAR_COLOR_PROPERTY] = is_string($color) && trim($color) !== '' ? trim($color) : null;
        }
        if (array_key_exists('timeZone', $payload)) {
            $timeZone = $payload['timeZone'];
            $mutations['{'.CalDAVPlugin::NS_CALDAV.'}calendar-timezone'] = is_string($timeZone) && trim($timeZone) !== '' ? trim($timeZone) : null;
        }

        if ($mutations !== []) {
            $propPatch = new PropPatch($mutations);
            $this->calBackend()->updateCalendar($this->calBackendCalendarId($instance), $propPatch);
            $propPatch->commit();
        }

        if (array_key_exists('shareWith', $payload)) {
            $this->shareInvites->apply($instance, $groupSlug, $payload['shareWith']);
        }

        if (array_key_exists('groupSlug', $payload)) {
            $this->transferOwner($username, $instance, $groupSlug, $payload['groupSlug']);
        }

        $instance->refresh();
        $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapCalendar($instance, $groupSlug);
    }

    public function delete(string $username, string $calendarId, array $options = []): array
    {
        $resolved = $this->resolveWritableCalendar($username, $calendarId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;

        if ($this->shareInvites->isSharee($instance)) {
            $this->shareVisibility->dismiss($username, (int) $instance->calendarid);

            return ['ok' => true];
        }

        if ((string) $instance->uri === CalendarCollectionUris::EVENT_DEFAULT) {
            throw new ApiHttpException(403, 'The default calendar cannot be deleted.', 'forbidden');
        }
        if ($this->isProvisionedGroupCalendar($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'The group calendar cannot be deleted.', 'forbidden');
        }

        $removeContents = (bool) ($options['onDestroyRemoveContents'] ?? false);
        $isSubscription = $this->subscriptionIdForInstance($instance, $groupSlug) !== null;
        if ($instance->objects()->where('componenttype', 'VEVENT')->exists() && ! $removeContents && ! $isSubscription) {
            throw new ApiHttpException(409, 'Calendar contains events.', 'calendarHasContents');
        }

        $this->calBackend()->deleteCalendar($this->calBackendCalendarId($instance));
        $this->forgetCalendarSideTables($username, (string) $instance->uri);

        return ['ok' => true];
    }

    public function deleteIncludingContents(string $username, string $calendarId): void
    {
        $this->delete($username, $calendarId, ['onDestroyRemoveContents' => true]);
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
            ?? $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

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

    public function changes(string $username, ?string $since): array
    {
        $instances = $this->accessibleVeventInstances($username);

        $currentState = $this->computeInstancesState($instances);
        $previous = $this->parseInstancesState($since);

        if ($since === null || $since === '' || $since === '0') {
            return [
                'oldState' => '0',
                'newState' => $currentState,
                'hasMoreChanges' => false,
                'created' => $this->apiIdsForInstances($instances),
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($since === $currentState) {
            return ['oldState' => $since, 'newState' => $currentState, 'hasMoreChanges' => false, 'created' => [], 'updated' => [], 'destroyed' => []];
        }

        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($instances as $instance) {
            $currentMap[$this->apiIdForInstance($instance)] = (int) ($instance->calendar?->synctoken ?? 1);
        }

        $created = [];
        $updated = [];
        foreach ($currentMap as $uri => $token) {
            if (! array_key_exists($uri, $previous)) {
                $created[] = $uri;
            } elseif ($previous[$uri] !== $token) {
                $updated[] = $uri;
            }
        }

        $destroyed = [];
        foreach (array_keys($previous) as $uri) {
            if (! array_key_exists($uri, $currentMap)) {
                $destroyed[] = $uri;
            }
        }

        return ['oldState' => $since, 'newState' => $currentState, 'hasMoreChanges' => false, 'created' => $created, 'updated' => $updated, 'destroyed' => $destroyed];
    }

    public function instanceMayWrite(CalendarInstance $instance): bool
    {
        return (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)
            !== SharingPlugin::ACCESS_READ;
    }

    /**
     * Whether $username may create/modify VEVENTs on a calendar owned by
     * $ownerPrincipalUri. Same relation JMAP/CalDAV use: owner/member
     * ACCESS_SHAREDOWNER, or a sharee instance that is not ACCESS_READ.
     *
     * Group members with no owner rows yet still pass — listing the group
     * home provisions the default VEVENT collection.
     */
    public function userMayWriteEventsOwnedBy(string $username, string $ownerPrincipalUri): bool
    {
        if ($username === '' || $ownerPrincipalUri === '') {
            return false;
        }

        $ownedCalendarIds = $this->ownedVeventCalendarIds($ownerPrincipalUri);
        $groupSlug = $this->groupSlugFromPrincipalUri($ownerPrincipalUri);
        $isGroupMember = $groupSlug !== null
            && in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true);

        if ($ownedCalendarIds === []) {
            return $isGroupMember;
        }
        if ($isGroupMember) {
            return true;
        }

        return CalendarInstance::query()
            ->where('principaluri', $this->principalUri($username))
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

        $owned = $this->findCalendarInstance($this->principalUri($username), $calendarId);
        if ($owned !== null) {
            return $owned;
        }

        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $instance = $this->findCalendarInstance(AdminConstants::GROUP_PREFIX.$slug, $calendarId);
            if ($instance !== null) {
                return $instance;
            }
        }

        return null;
    }

    public function apiIdForInstance(CalendarInstance $instance): string
    {
        $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);
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
        $uris = [$this->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $uris[] = AdminConstants::GROUP_PREFIX.$slug;
        }

        return $uris;
    }

    public function assertEventWritable(CalendarInstance $instance): void
    {
        if ($this->shareInvites->isReadOnly($instance)) {
            throw new ApiHttpException(403, 'This calendar is read-only.', 'forbidden');
        }
    }

    /**
     * @return Collection<int, CalendarInstance>
     */
    public function accessibleVeventInstances(string $username)
    {
        $instances = $this->personalVeventInstances($username);
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            foreach ($this->groupVeventInstances($slug) as $groupInstance) {
                $instances->push($groupInstance);
            }
        }

        return $this->shareVisibility->rejectDismissedSharees(
            $username,
            $this->preferHighestAccessPerCalendar($instances),
        );
    }

    /**
     * Sharing a personal calendar with a group you belong to creates a second
     * instance (group sharee) of the same calendarid. Keep the owner copy.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    private function preferHighestAccessPerCalendar($instances)
    {
        $chosen = [];
        foreach ($instances as $instance) {
            $calendarId = (int) $instance->calendarid;
            $rank = match ((int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)) {
                SharingPlugin::ACCESS_SHAREDOWNER => 3,
                SharingPlugin::ACCESS_READWRITE => 2,
                SharingPlugin::ACCESS_READ => 1,
                default => 0,
            };
            if (! isset($chosen[$calendarId]) || $rank > $chosen[$calendarId]['rank']) {
                $chosen[$calendarId] = ['rank' => $rank, 'instance' => $instance];
            }
        }

        return $instances
            ->filter(function (CalendarInstance $instance) use ($chosen): bool {
                return $chosen[(int) $instance->calendarid]['instance']->is($instance);
            })
            ->values();
    }

    /**
     * @return Collection<int, CalendarInstance>
     */
    private function personalVeventInstances(string $username)
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get();
    }

    /**
     * Calendars the user may update (name, color, …). Provisioned group calendars
     * are included; {@see delete()} separately forbids destroying them.
     *
     * @return array{0: CalendarInstance, 1: ?string}|null
     */
    private function resolveWritableCalendar(string $username, string $calendarId): ?array
    {
        $instance = $this->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            return null;
        }

        $groupSlug = CalendarCollectionUris::parseGroupCalendarApiId($calendarId)
            ?? $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return [$instance, $groupSlug];
    }

    private function isProvisionedGroupCalendar(CalendarInstance $instance, ?string $groupSlug): bool
    {
        return $groupSlug !== null
            && (string) $instance->uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug);
    }

    /**
     * Move the owner instance between personal and group principals.
     * Events stay on calendarid; sharee rows and shareWith grants are untouched.
     */
    private function transferOwner(
        string $username,
        CalendarInstance $instance,
        ?string $currentGroupSlug,
        mixed $requested,
    ): void {
        $this->assertOwnerTransferAllowed($instance, $currentGroupSlug);
        $newGroupSlug = $this->normalizePatchGroupSlug($requested);
        if ($newGroupSlug === $currentGroupSlug) {
            return;
        }

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

    private function normalizePatchGroupSlug(mixed $requested): ?string
    {
        if ($requested !== null && ! is_string($requested)) {
            throw new ApiHttpException(400, 'groupSlug must be a string or null.', 'invalidProperties');
        }

        $groupSlug = is_string($requested) ? trim($requested) : null;

        return $groupSlug === '' ? null : $groupSlug;
    }

    private function principalUriForOwnerScope(
        string $username,
        CalendarInstance $instance,
        ?string $groupSlug,
    ): string {
        if ($groupSlug === null) {
            return $this->principalUri($username);
        }
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
        if ((string) $instance->uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug)) {
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
        if ($base === '' || in_array($base, CalendarCollectionUris::reservedEventUris(), true)) {
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

    private function computeInstancesState($instances): string
    {
        $parts = [];
        foreach ($instances as $instance) {
            $parts[] = $this->apiIdForInstance($instance).':'.(int) ($instance->calendar?->synctoken ?? 1);
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    private function parseInstancesState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }
        if (! preg_match('/^(\d+):(.+)$/', $state, $matches)) {
            return null;
        }
        $entries = $matches[2] === '' ? [] : explode(',', $matches[2]);
        if (count($entries) !== (int) $matches[1]) {
            return null;
        }
        $map = [];
        foreach ($entries as $entry) {
            $parts = explode(':', $entry, 2);
            if (count($parts) !== 2 || $parts[0] === '' || ! ctype_digit($parts[1])) {
                return null;
            }
            $map[$parts[0]] = (int) $parts[1];
        }

        return $map;
    }

    private function calBackendCalendarId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function mapCalendar(CalendarInstance $instance, ?string $groupSlug = null): array
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

        $rights = match ((int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)) {
            SharingPlugin::ACCESS_READ => ['mayRead' => true, 'mayWrite' => false, 'mayShare' => false, 'mayDelete' => true],
            SharingPlugin::ACCESS_READWRITE => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => true],
            default => [
                'mayRead' => true,
                'mayWrite' => true,
                'mayShare' => $mayShare,
                'mayDelete' => ! $isProvisionedGroup && $uri !== CalendarCollectionUris::EVENT_DEFAULT,
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
            'id' => $isProvisionedGroup ? CalendarCollectionUris::groupCalendarApiId($groupSlug) : $uri,
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

        $groupSlug ??= $this->groupSlugFromPrincipalUri((string) $instance->principaluri);
        if ($groupSlug === null) {
            return null;
        }

        return $this->sharedGroupSubscriptionId($uri);
    }

    /**
     * Group-shared collection: same uri on the group principal. A personal
     * subscription that reuses the slug must not attach to this collection.
     */
    private function sharedGroupSubscriptionId(string $calendarUri): ?string
    {
        foreach ($this->subscriptionRowsForUri($calendarUri) as $row) {
            if ($this->findCalendarInstance($this->principalUri($row['username']), $calendarUri) === null) {
                return $row['id'];
            }
        }

        return null;
    }

    /**
     * @return list<array{id: string, username: string}>
     */
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

    private function forgetCalendarSideTables(string $username, string $calendarUri): void
    {
        CalendarSubscription::query()
            ->where('username', $username)
            ->where('calendar_uri', $calendarUri)
            ->delete();
        CalendarFeedToken::query()
            ->where('owner_username', $username)
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
     * @return list<CalendarInstance>
     */
    private function groupVeventInstances(string $groupSlug): array
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$groupSlug;
        $group = Principal::query()->where('uri', $groupUri)->first(['uri', 'displayname']);
        if ($group === null) {
            return [];
        }

        $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
            (string) $group->uri,
            (string) ($group->displayname ?? $groupSlug),
        );

        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $groupUri)
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all();
    }

    private function findCalendarInstance(string $principalUri, string $calendarUri): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', $calendarUri)
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->first();
    }

    private function ensureGroupCalendarInstance(string $groupSlug): ?CalendarInstance
    {
        foreach ($this->groupVeventInstances($groupSlug) as $instance) {
            if ((string) $instance->uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug)) {
                return $instance;
            }
        }

        return null;
    }

    private function groupSlugFromPrincipalUri(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return null;
        }

        $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));

        return $slug !== '' ? $slug : null;
    }

    /**
     * @return list<int>
     */
    private function ownedVeventCalendarIds(string $ownerPrincipalUri): array
    {
        return CalendarInstance::query()
            ->where('principaluri', $ownerPrincipalUri)
            ->where(function ($query): void {
                $query->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
                    ->orWhereNull('access');
            })
            ->whereHas('calendar', fn ($query) => $query->supportsVevent())
            ->pluck('calendarid')
            ->all();
    }

    /**
     * @param  iterable<CalendarInstance>  $instances
     * @return list<string>
     */
    private function apiIdsForInstances(iterable $instances): array
    {
        $ids = [];
        foreach ($instances as $instance) {
            $ids[] = $this->apiIdForInstance($instance);
        }

        return $ids;
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}
