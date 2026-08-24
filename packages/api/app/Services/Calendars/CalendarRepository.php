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

final class CalendarRepository
{
    /** Sabre CalDAV PDO maps this Apple property onto `calendarinstances.calendarcolor`. */
    private const CALENDAR_COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    /** @var array<string, array<string, string>> */
    private array $subscriptionIdsByUser = [];

    /** @var array<string, string>|null calendar_uri => subscription id (any principal) */
    private ?array $subscriptionIdsByUri = null;

    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
        private readonly DriveGroupResolver $groups,
    ) {}

    public function list(string $username): array
    {
        $instances = $this->personalVeventInstances($username);

        $calendars = $instances
            ->map(fn (CalendarInstance $instance): array => $this->mapCalendar($instance))
            ->values()
            ->all();

        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            foreach ($this->groupVeventInstances($slug) as $instance) {
                $calendars[] = $this->mapCalendar($instance, $slug);
            }
        }

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

        return $this->mapCalendar($instance, $groupSlug);
    }

    public function update(string $username, string $calendarId, array $payload): array
    {
        $resolved = $this->resolveWritableCalendar($username, $calendarId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;

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

        $instance->refresh();

        return $this->mapCalendar($instance, $groupSlug);
    }

    public function delete(string $username, string $calendarId, array $options = []): array
    {
        $resolved = $this->resolveWritableCalendar($username, $calendarId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;

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
        return isset($this->subscriptionIdMap($username)[$calendarId])
            || isset($this->subscriptionIdByCalendarUri()[$calendarId]);
    }

    public function findOwnedPersonalCalendar(string $username, string $calendarId): CalendarInstance
    {
        if (CalendarCollectionUris::parseGroupCalendarApiId($calendarId) !== null) {
            throw new ApiHttpException(403, 'Only owned personal calendars can be published.', 'forbidden');
        }

        $instance = $this->findCalendarInstance($this->principalUri($username), $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        if ($this->groupSlugFromPrincipalUri((string) $instance->principaluri) !== null) {
            throw new ApiHttpException(403, 'Only owned personal calendars can be published.', 'forbidden');
        }

        return $instance;
    }

    public function changes(string $username, ?string $since): array
    {
        $instances = $this->personalVeventInstances($username);

        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            foreach ($this->groupVeventInstances($slug) as $groupInstance) {
                $instances->push($groupInstance);
            }
        }

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

        return $instances;
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

        $rights = match ((int) ($instance->access ?? 1)) {
            2 => ['mayRead' => true, 'mayWrite' => false, 'mayShare' => false, 'mayDelete' => false],
            3 => ['mayRead' => true, 'mayWrite' => true, 'mayShare' => false, 'mayDelete' => false],
            default => [
                'mayRead' => true,
                'mayWrite' => true,
                'mayShare' => false,
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
            'shareWith' => null,
            'myRights' => $rights,
        ];
    }

    private function subscriptionIdForInstance(CalendarInstance $instance, ?string $groupSlug = null): ?string
    {
        return $this->subscriptionIdByCalendarUri()[(string) $instance->uri] ?? null;
    }

    /**
     * @return array<string, string>
     */
    private function subscriptionIdByCalendarUri(): array
    {
        if ($this->subscriptionIdsByUri === null) {
            $this->subscriptionIdsByUri = CalendarSubscription::query()
                ->pluck('id', 'calendar_uri')
                ->all();
        }

        return $this->subscriptionIdsByUri;
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
            ->where('calendar_uri', $calendarUri)
            ->delete();
        CalendarFeedToken::query()
            ->where('owner_username', $username)
            ->where('calendar_uri', $calendarUri)
            ->delete();
        unset($this->subscriptionIdsByUser[$username]);
        $this->subscriptionIdsByUri = null;
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
