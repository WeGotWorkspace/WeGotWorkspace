<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarCollectionMeta;
use App\Models\CalendarInstance;
use App\Models\CalendarSubscription;
use App\Models\ChatChannelMeta;
use App\Services\Admin\AdminConstants;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Projects\ProjectRegistry;
use App\Services\Teams\TeamRoles;
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
    public const PROJECT_ITEM_MESSAGE = 'This belongs to a Project. Rename, recolor or delete the Project instead.';

    public function __construct(
        private readonly DriveGroupResolver $groups,
        private readonly CalendarShareInvites $shareInvites,
        private readonly CalendarShareVisibility $shareVisibility,
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
        private readonly TeamRoles $teamRoles,
        private readonly AdminRoleResolver $admins,
        private readonly ProjectRegistry $projects,
    ) {}

    /**
     * Personal + group + inbound sharee instances for $username, filtered by
     * component set, then highest-access-per-calendarid, then dismissed and hidden shares.
     *
     * @return Collection<int, CalendarInstance>
     */
    public function accessibleInstances(string $username, CollectionKind $kind)
    {
        return $this->accessibleInstancesByKind($username, [$kind])[$kind->value];
    }

    /**
     * {@see accessibleInstances()} for several kinds with one read of the instances, so the
     * JMAP push check does not repeat the Team lookups per kind (#2243). Every kind lists
     * exactly what accessibleInstances() lists for it, in the same order: personal
     * instances first, then each Team's, each by calendarorder and id. A collection has one
     * kind, so the filters (all per instance or per calendarid) give the same result per kind.
     *
     * @param  non-empty-list<CollectionKind>  $kinds
     * @return array<string, Collection<int, CalendarInstance>> keyed by the kind's value
     */
    public function accessibleInstancesByKind(string $username, array $kinds): array
    {
        $owners = [$this->principalUri($username), ...$this->provisionedGroupUris($username)];
        $ownerRank = [];
        foreach ($owners as $rank => $owner) {
            $ownerRank[strtolower($owner)] = $rank;
        }

        $fetched = CalendarInstance::query()
            ->with('calendar')
            ->whereIn('principaluri', $owners)
            ->whereHas('calendar', fn ($query) => $query->ofKinds($kinds))
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all();
        // usort is stable: inside one owner the calendarorder, id order of the query stays.
        usort($fetched, static fn (CalendarInstance $a, CalendarInstance $b): int => ($ownerRank[strtolower((string) $a->principaluri)] ?? PHP_INT_MAX)
            <=> ($ownerRank[strtolower((string) $b->principaluri)] ?? PHP_INT_MAX));
        $visible = $this->visibleHighestAccess($username, new Collection($fetched));

        $byKind = [];
        foreach ($kinds as $kind) {
            $byKind[$kind->value] = new Collection;
        }
        $kindOf = count($kinds) === 1 ? [] : CalendarCollectionMeta::query()
            ->whereIn('calendarid', $visible->map(static fn (CalendarInstance $i): int => (int) $i->calendarid)->unique()->values()->all())
            ->pluck('kind', 'calendarid')
            ->all();
        foreach ($visible as $instance) {
            $kind = count($kinds) === 1 ? $kinds[0]->value : (string) ($kindOf[(int) $instance->calendarid] ?? '');
            if (isset($byKind[$kind])) {
                $byKind[$kind]->push($instance);
            }
        }

        return $byKind;
    }

    /**
     * Hidden shares go first, so a hidden higher-ranked Team grant cannot displace a
     * visible direct grant; then highest access per calendar; then dismissed shares.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function visibleHighestAccess(string $username, $instances)
    {
        return $this->withoutArchivedProjects($this->shareVisibility->rejectDismissedSharees(
            $username,
            $this->preferHighestAccessPerCalendar($this->shareVisibility->rejectHiddenSharees($username, $instances)),
        ));
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
     * Sharees may change their instance name/color only. On the owner side, a Project
     * collection's name and color are the Project's (#817 B1).
     *
     * @param  list<string>  $disallowedKeys
     * @param  array<string, mixed>  $payload
     */
    public function assertPatchAllowed(
        CalendarInstance $instance,
        array $payload,
        array $disallowedKeys,
        string $message,
    ): void {
        if (! $this->shareInvites->isSharee($instance)) {
            $this->assertProjectPatchAllowed($instance, $payload);

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
     * Team-owned collections (not inbound sharee copies) may be destroyed only
     * by a team admin of that Team (#2278). An organization admin has no bypass.
     * Sharees still dismiss; personal owners stay. A Team meeting room is no Team
     * collection ($meeting): it keeps the organization-admin rule from before #2278.
     */
    public function mayDeleteGroupOwned(string $username, CalendarInstance $instance, bool $meeting = false): bool
    {
        if ($this->shareInvites->isSharee($instance)) {
            return true;
        }
        if ($this->isProjectCollection($instance)) {
            return false;
        }

        $principalUri = $instance->principaluri;

        return ! is_string($principalUri)
            || ! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)
            || ($meeting
                ? $this->admins->isAdmin($username)
                : $this->teamRoles->mayManageTeamCollections(
                    $username,
                    substr($principalUri, strlen(AdminConstants::GROUP_PREFIX)),
                ));
    }

    public function assertGroupOwnedDeleteAllowed(string $username, CalendarInstance $instance, bool $meeting = false): void
    {
        $this->assertGroupOwnedAdmin($username, $instance, 'Only a team admin can delete a team collection.', $meeting);
    }

    /**
     * Moving a group-owned collection out of its group (to personal or to
     * another group) removes it for the rest of the group, so it needs the
     * same right as deleting it. Personal collections move freely.
     */
    public function assertGroupOwnedTransferAllowed(string $username, CalendarInstance $instance, bool $meeting = false): void
    {
        $this->assertGroupOwnedAdmin(
            $username,
            $instance,
            'Only a team admin can move a team collection out of its team.',
            $meeting,
        );
    }

    /**
     * Adding a collection to a Team, by creating it there or by moving one in,
     * is for that Team's team admins (#2278). The caller has checked membership.
     */
    public function assertMayAddToTeam(string $username, string $groupSlug): void
    {
        $this->teamRoles->assertMayManageTeamCollections(
            $username,
            $groupSlug,
            'Only a team admin can add a collection to a team.',
        );
    }

    /**
     * A named channel is a Team collection. A meeting room started with a Team is not:
     * every member may open one.
     */
    public function assertMayAddChannelToTeam(string $username, string $groupSlug, string $chatKind): void
    {
        if ($chatKind !== ChatChannelMeta::KIND_MEETING) {
            $this->assertMayAddToTeam($username, $groupSlug);
        }
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

    /** The id of the Project that owns this collection, or null (#817 B1). */
    public function projectIdOf(CalendarInstance $instance): ?string
    {
        return $this->projects->projectIdFor((int) $instance->calendarid);
    }

    /**
     * The Project fields of a collection response: `projectId`, and `myRights` with `mayRename`.
     *
     * @param  array<string, bool>  $rights
     * @return array{projectId: ?string, myRights: array<string, bool>}
     */
    public function projectFields(CalendarInstance $instance, array $rights): array
    {
        return [
            'projectId' => $this->projectIdOf($instance),
            'myRights' => [...$rights, 'mayRename' => $this->mayRename($instance)],
        ];
    }

    /**
     * Whether the caller may rename or recolor the collection itself. A Project collection
     * follows its Project, so only a sharee's own copy can be renamed (#817 B1).
     */
    public function mayRename(CalendarInstance $instance): bool
    {
        return $this->shareInvites->isSharee($instance) || ! $this->isProjectCollection($instance);
    }

    /**
     * A Project collection's name and color are the Project's: an owner-side change is 403.
     * A sharee's own name and color stay theirs; other properties stay writable.
     *
     * @param  array<string, mixed>  $payload
     */
    private function assertProjectPatchAllowed(CalendarInstance $instance, array $payload): void
    {
        if ($this->mayRename($instance)) {
            return;
        }
        // Sending the current value back (a form that posts every field) is no change.
        $renames = array_key_exists('name', $payload)
            && trim((string) $payload['name']) !== trim((string) ($instance->displayname ?? ''));
        $recolors = array_key_exists('color', $payload)
            && CalendarColorPalette::normalize($payload['color'])
                !== CalendarColorPalette::normalize($instance->calendarcolor);
        if ($renames || $recolors) {
            throw new ApiHttpException(403, self::PROJECT_ITEM_MESSAGE, 'project_item');
        }
    }

    private function isProjectCollection(CalendarInstance $instance): bool
    {
        return $this->projectIdOf($instance) !== null;
    }

    private function assertGroupOwnedAdmin(string $username, CalendarInstance $instance, string $message, bool $meeting): void
    {
        if (! $this->shareInvites->isSharee($instance) && $this->isProjectCollection($instance)) {
            throw new ApiHttpException(403, self::PROJECT_ITEM_MESSAGE, 'project_item');
        }
        if (! $this->mayDeleteGroupOwned($username, $instance, $meeting)) {
            throw new ApiHttpException(403, $message, 'team_admin_only');
        }
    }

    /**
     * Lookup by id: the user's own collection first, then the groups they may
     * use. A dismissed or hidden inbound share answers like a missing collection.
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
            : $this->withoutDismissedOrHidden($username, new Collection([$instance]))->first();
    }

    /**
     * Drops inbound shares the user dismissed and shares hidden because the owner no
     * longer shares a Team with them, for item lookups that collect candidate
     * instances themselves.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function withoutDismissedOrHidden(string $username, Collection $instances): Collection
    {
        return $this->withoutArchivedProjects($this->shareVisibility->rejectInvisibleSharees($username, $instances));
    }

    /**
     * The collections of an archived Project are gone for everyone, sharees included, until
     * it is unarchived (#819 B2).
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function withoutArchivedProjects(Collection $instances): Collection
    {
        return $instances
            ->reject(fn (CalendarInstance $instance): bool => $this->projects->isArchived((int) $instance->calendarid))
            ->values();
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
     * Read-only: the event calendars that count toward $username's Team
     * availability, as they exist now. Personal ones are the owner's own
     * (`ACCESS_SHAREDOWNER` under their principal); Team ones are owned by a
     * Team they belong to. Shared-in copies and ICS subscriptions never count.
     * Unlike {@see accessibleInstances()} this never provisions a missing Team
     * collection, so a busy-period read inserts nothing.
     *
     * @return array{personal: list<CalendarInstance>, team: list<CalendarInstance>}
     */
    public function availabilitySourceInstances(string $username): array
    {
        $teamUris = array_map(
            static fn (string $slug): string => AdminConstants::GROUP_PREFIX.$slug,
            $this->groups->allowedGroupSlugs($username),
        );
        $owned = fn (array $principalUris) => CalendarInstance::query()
            ->with('calendar')
            ->whereIn('principaluri', $principalUris)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->whereHas('calendar', fn ($query) => $query->ofKind(CollectionKind::EventCalendar))
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get();

        $personalSubscriptions = CalendarSubscription::query()
            ->where('principal_uri', $this->principalUri($username))
            ->pluck('calendar_uri')
            ->all();
        $personal = $owned([$this->principalUri($username)])
            ->reject(fn (CalendarInstance $instance): bool => in_array((string) $instance->uri, $personalSubscriptions, true));
        $team = $teamUris === [] ? new Collection : $owned($teamUris)
            ->reject(fn (CalendarInstance $instance): bool => $this->isTeamSubscription((string) $instance->principaluri, (string) $instance->uri));

        return [
            'personal' => array_values($this->withoutArchivedProjects($personal->values())->all()),
            'team' => array_values($this->withoutArchivedProjects($team->values())->all()),
        ];
    }

    /** A subscription made into a Team is keyed on the Team principal that owns the calendar. */
    private function isTeamSubscription(string $teamPrincipalUri, string $calendarUri): bool
    {
        return CalendarSubscription::query()
            ->where('principal_uri', $teamPrincipalUri)
            ->where('calendar_uri', $calendarUri)
            ->exists();
    }

    /**
     * The principal uris of the user's Teams that exist, in allowedGroupSlugs() order, after
     * provisioning their default collections.
     *
     * @return list<string>
     */
    private function provisionedGroupUris(string $username): array
    {
        $displayNames = $this->groups->groupDisplayNames($username);
        $this->calendarCollectionsProvisioner->ensureForGroupPrincipals($displayNames);

        return array_map('strval', array_keys($displayNames));
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }
}
