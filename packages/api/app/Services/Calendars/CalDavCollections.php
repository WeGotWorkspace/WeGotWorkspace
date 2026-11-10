<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Exceptions\ApiHttpException;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Database\Eloquent\Builder;

/**
 * The plumbing every CalDAV-backed collection repository shares (#1639):
 * calendars, task lists, notebooks, chat channels and docs thread pools are
 * all Sabre calendar instances. Each repository keeps its own rules (ids,
 * reserved uris, messages); this class holds what was copied between them.
 *
 * A `$calendarScope` narrows the `calendar` relation to one app's
 * collections, e.g. `fn ($query) => $query->ofKind(CollectionKind::TaskList)`.
 * Backend writes go through {@see WgwCalendarBackendFactory}.
 */
final class CalDavCollections
{
    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $provisioner,
        private readonly DriveGroupResolver $groups,
    ) {}

    /**
     * The id pair Sabre's PDO backend takes for one instance.
     *
     * @return array{0: int, 1: int} [calendarid, instance id]
     */
    public function backendId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    public function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    public function groupSlugFromPrincipalUri(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return null;
        }

        $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));

        return $slug !== '' ? $slug : null;
    }

    /** A PATCH `groupSlug`: a string moves to that group, null or blank back to the user. */
    public function normalizePatchGroupSlug(mixed $requested): ?string
    {
        if ($requested !== null && ! is_string($requested)) {
            throw new ApiHttpException(400, 'groupSlug must be a string or null.', 'invalidProperties');
        }

        $groupSlug = is_string($requested) ? trim($requested) : null;

        return $groupSlug === '' ? null : $groupSlug;
    }

    /**
     * @param  \Closure(Builder<Calendar>): mixed  $calendarScope
     */
    public function findInstance(string $principalUri, string $uri, \Closure $calendarScope): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', $uri)
            ->whereHas('calendar', $calendarScope)
            ->first();
    }

    /**
     * A group's collections of one app, provisioning the group's defaults
     * first. Empty when the group does not exist.
     *
     * @param  \Closure(Builder<Calendar>): mixed  $calendarScope
     * @return list<CalendarInstance>
     */
    public function groupInstances(string $groupSlug, \Closure $calendarScope): array
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$groupSlug;
        $group = Principal::query()->where('uri', $groupUri)->first(['uri', 'displayname']);
        if ($group === null) {
            return [];
        }

        $this->provisioner->ensureForGroupPrincipal(
            (string) $group->uri,
            (string) ($group->displayname ?? $groupSlug),
        );

        return array_values(CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $groupUri)
            ->whereHas('calendar', $calendarScope)
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all());
    }

    /**
     * One group collection by uri, typically the group's provisioned default.
     *
     * @param  \Closure(Builder<Calendar>): mixed  $calendarScope
     */
    public function findGroupInstance(string $groupSlug, string $uri, \Closure $calendarScope): ?CalendarInstance
    {
        foreach ($this->groupInstances($groupSlug, $calendarScope) as $instance) {
            if ((string) $instance->uri === $uri) {
                return $instance;
            }
        }

        return null;
    }

    /**
     * The principal a collection is owned by after an owner change: the user,
     * or a group the user belongs to (whose defaults are provisioned first).
     */
    public function ownerScopePrincipalUri(string $username, ?string $groupSlug): string
    {
        if ($groupSlug === null) {
            return $this->principalUri($username);
        }
        if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
            throw new ApiHttpException(403, 'Not a member of this team.', 'forbidden');
        }
        $principalUri = AdminConstants::GROUP_PREFIX.$groupSlug;
        $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
        if ($group === null) {
            throw new ApiHttpException(404, 'Team not found.', 'not_found');
        }
        $this->provisioner->ensureForGroupPrincipal(
            (string) $group->uri,
            (string) ($group->displayname ?? $groupSlug),
        );

        return $principalUri;
    }

    /**
     * Collection-level changes over the instances a user can see. The state is
     * `count:id:token,id:token,…`, one entry per instance in list order, with
     * each collection's Sabre sync token. An empty list gives the state `0:`.
     *
     * @param  iterable<CalendarInstance>  $instances
     * @param  \Closure(CalendarInstance): string  $apiId
     * @return array{oldState: string, newState: string, created: list<string>, updated: list<string>, destroyed: list<string>}
     */
    public function changes(iterable $instances, ?string $since, \Closure $apiId): array
    {
        $current = [];
        $parts = [];
        foreach ($instances as $instance) {
            $id = $apiId($instance);
            $token = (int) ($instance->calendar->synctoken ?? 1);
            $parts[] = $id.':'.$token;
            $current[] = [$id, $token];
        }
        $currentState = (string) count($parts).':'.implode(',', $parts);

        if ($since === null || $since === '' || $since === '0') {
            return [
                'oldState' => '0',
                'newState' => $currentState,
                'created' => array_column($current, 0),
                'updated' => [],
                'destroyed' => [],
            ];
        }

        if ($since === $currentState) {
            return ['oldState' => $since, 'newState' => $currentState, 'created' => [], 'updated' => [], 'destroyed' => []];
        }

        $previous = $this->parseState($since);
        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($current as [$id, $token]) {
            $currentMap[$id] = $token;
        }

        $created = [];
        $updated = [];
        foreach ($currentMap as $id => $token) {
            $id = (string) $id;
            if (! array_key_exists($id, $previous)) {
                $created[] = $id;
            } elseif ($previous[$id] !== $token) {
                $updated[] = $id;
            }
        }

        $destroyed = [];
        foreach (array_keys($previous) as $id) {
            if (! array_key_exists($id, $currentMap)) {
                $destroyed[] = (string) $id;
            }
        }

        return ['oldState' => $since, 'newState' => $currentState, 'created' => $created, 'updated' => $updated, 'destroyed' => $destroyed];
    }

    /**
     * @return array<string, int>|null id => sync token, or null when malformed
     */
    private function parseState(string $state): ?array
    {
        if (! preg_match('/^(\d+):(.*)$/', $state, $matches)) {
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
}
