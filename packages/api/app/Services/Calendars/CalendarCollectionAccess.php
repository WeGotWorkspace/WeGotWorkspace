<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Database\Eloquent\Collection;
use Sabre\CalDAV\Plugin as CalDAVPlugin;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Shared CalDAV collection ACL: list accessible instances, dedupe owner vs
 * inbound sharee, sharee name/color PATCH, dismiss-on-delete, and item writes.
 * Each surface asks for its own CollectionKind. Component scopes are not usable
 * here: notebooks, chat channels and docs thread pools are all VJOURNAL-only,
 * so only the stored kind separates them.
 */
final class CalendarCollectionAccess
{
    public function __construct(
        private readonly DriveGroupResolver $groups,
        private readonly CalendarShareInvites $shareInvites,
        private readonly CalendarShareVisibility $shareVisibility,
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
        private readonly AdminRoleResolver $admins,
    ) {}

    /**
     * Personal + group + inbound sharee instances for $username, filtered by
     * component set, then highest-access-per-calendarid, then dismissals.
     *
     * @return Collection<int, CalendarInstance>
     */
    public function accessibleInstances(string $username, CollectionKind $kind)
    {
        $instances = $this->personalInstances($username, $kind);
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            foreach ($this->groupInstances($slug, $kind) as $groupInstance) {
                $instances->push($groupInstance);
            }
        }

        return $this->shareVisibility->rejectDismissedSharees(
            $username,
            $this->preferHighestAccessPerCalendar($instances),
        );
    }

    /**
     * Sharing a personal collection with a group you belong to creates a second
     * instance (group sharee) of the same calendarid. Keep the owner copy.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function preferHighestAccessPerCalendar($instances)
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

    public function assertCollectionWritable(
        CalendarInstance $instance,
        string $message = 'This collection is read-only.',
    ): void {
        if ($this->shareInvites->isReadOnly($instance)) {
            throw new ApiHttpException(403, $message, 'forbidden');
        }
    }

    /**
     * Sharees may change their instance name/color only.
     *
     * @param  list<string>  $disallowedKeys
     * @param  array<string, mixed>  $payload
     */
    public function assertShareePatchAllowed(
        CalendarInstance $instance,
        array $payload,
        array $disallowedKeys,
        string $message,
    ): void {
        if (! $this->shareInvites->isSharee($instance)) {
            return;
        }

        $disallowed = array_values(array_filter(
            $disallowedKeys,
            static fn (string $key): bool => array_key_exists($key, $payload),
        ));
        if ($disallowed !== []) {
            throw new ApiHttpException(403, $message, 'forbidden');
        }
    }

    /**
     * Group-owned collections (not inbound sharee copies) may be destroyed
     * only by an instance admin. Sharees still dismiss; personal owners stay.
     */
    public function mayDeleteGroupOwned(string $username, CalendarInstance $instance): bool
    {
        if ($this->shareInvites->isSharee($instance)) {
            return true;
        }

        $principalUri = $instance->principaluri;

        return ! is_string($principalUri)
            || ! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)
            || $this->admins->isAdmin($username);
    }

    public function assertGroupOwnedDeleteAllowed(string $username, CalendarInstance $instance): void
    {
        $this->assertGroupOwnedAdmin($username, $instance, 'Only an instance admin can delete a group collection.');
    }

    /**
     * Moving a group-owned collection out of its group (to personal or to
     * another group) removes it for the rest of the group, so it needs the
     * same right as deleting it. Personal collections move freely.
     */
    public function assertGroupOwnedTransferAllowed(string $username, CalendarInstance $instance): void
    {
        $this->assertGroupOwnedAdmin(
            $username,
            $instance,
            'Only an instance admin can move a group collection out of its group.',
        );
    }

    /**
     * Leave an inbound share: it drops out of listings and out of every lookup
     * by id until restored. The owner's grant stays. Returns true when the
     * instance was a sharee.
     */
    public function dismissIfSharee(string $username, CalendarInstance $instance): bool
    {
        if (! $this->shareInvites->isSharee($instance)) {
            return false;
        }

        $this->shareVisibility->dismiss($username, (int) $instance->calendarid);

        return true;
    }

    private function assertGroupOwnedAdmin(string $username, CalendarInstance $instance, string $message): void
    {
        if (! $this->mayDeleteGroupOwned($username, $instance)) {
            throw new ApiHttpException(403, $message, 'group_delete_admin_only');
        }
    }

    /**
     * Lookup by id: the user's own collection first, then the groups they may
     * use. A dismissed inbound share answers like a missing collection.
     *
     * @param  callable(string): ?CalendarInstance  $findIn  the instance with the id under a principal uri
     */
    public function findReachable(string $username, callable $findIn): ?CalendarInstance
    {
        $instance = $findIn($this->principalUri($username));
        foreach ($instance === null ? $this->groups->allowedGroupSlugs($username) : [] as $slug) {
            $instance = $findIn(AdminConstants::GROUP_PREFIX.$slug);
            if ($instance !== null) {
                break;
            }
        }

        return $instance === null
            ? null
            : $this->withoutDismissed($username, new Collection([$instance]))->first();
    }

    /**
     * Drops inbound shares the user dismissed, for item lookups that collect
     * candidate instances themselves.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function withoutDismissed(string $username, Collection $instances): Collection
    {
        return $this->shareVisibility->rejectDismissedSharees($username, $instances);
    }

    /**
     * A collection patch with `isSubscribed: true` restores a dismissed inbound
     * share before the patch looks the collection up, so the rest of the patch
     * applies to it. The sharee instance only exists while the owner's grant
     * does, so a revoked share cannot come back this way.
     *
     * @param  array<string, mixed>  $payload
     */
    public function restoreWhenSubscribing(string $username, CollectionKind $kind, string $apiId, array $payload): void
    {
        if ($this->requestedSubscription($payload) !== true) {
            return;
        }

        $principalUris = [$this->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $principalUris[] = AdminConstants::GROUP_PREFIX.$slug;
        }
        $instances = CalendarInstance::query()
            ->whereIn('principaluri', $principalUris)
            ->where('uri', $apiId)
            ->whereHas('calendar', fn ($query) => $query->ofKind($kind))
            ->get();
        foreach ($instances as $instance) {
            if ($this->shareInvites->isSharee($instance)) {
                $this->shareVisibility->restore($username, (int) $instance->calendarid);
            }
        }
    }

    /**
     * A collection patch with `isSubscribed: false` dismisses an inbound share,
     * like a delete does. Owners and group members have nothing to dismiss.
     *
     * @param  array<string, mixed>  $payload
     */
    public function dismissWhenUnsubscribing(string $username, CalendarInstance $instance, array $payload): void
    {
        if ($this->requestedSubscription($payload) === false) {
            $this->dismissIfSharee($username, $instance);
        }
    }

    /**
     * DAV property changes for the name, description and color a collection
     * patch may carry. Callers add their own kind-specific properties.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, ?string>
     */
    public function propertyMutations(array $payload): array
    {
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
            $mutations['{http://apple.com/ns/ical/}calendar-color'] = is_string($color) && trim($color) !== '' ? trim($color) : null;
        }

        return $mutations;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function requestedSubscription(array $payload): ?bool
    {
        if (! array_key_exists('isSubscribed', $payload)) {
            return null;
        }
        if (! is_bool($payload['isSubscribed'])) {
            throw new ApiHttpException(400, 'isSubscribed must be a boolean.', 'invalidProperties', ['isSubscribed']);
        }

        return $payload['isSubscribed'];
    }

    /**
     * @return Collection<int, CalendarInstance>
     */
    private function personalInstances(string $username, CollectionKind $kind)
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->whereHas('calendar', fn ($query) => $query->ofKind($kind))
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get();
    }

    /**
     * @return list<CalendarInstance>
     */
    private function groupInstances(string $groupSlug, CollectionKind $kind): array
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

        return array_values(CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $groupUri)
            ->whereHas('calendar', fn ($query) => $query->ofKind($kind))
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all());
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }
}
