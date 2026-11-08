<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarShareDismissal;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Teams\TeamColleagues;
use Illuminate\Database\Eloquent\Collection;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Which inbound shares a user sees. Two filters, applied together by
 * {@see CalendarCollectionAccess} to listings and to every lookup by id:
 *
 * - Dismissal: per user, does not change the owner's shareWith grant; {@see restore} is the inverse.
 * - Hiding (Epic #1915): a share from a user who no longer shares a Team with the sharee, computed
 *   on read from {@see TeamColleagues::grantIsVisible}. Nothing is stored or deleted, so the share
 *   comes back when they share a Team again. Restoring a dismissal does not bypass it.
 */
final class CalendarShareVisibility
{
    public function __construct(private readonly TeamColleagues $colleagues) {}

    /**
     * @return list<int>
     */
    public function dismissedCalendarIds(string $username): array
    {
        return array_values(CalendarShareDismissal::query()
            ->where('username', $username)
            ->pluck('calendarid')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all());
    }

    public function isDismissed(string $username, int $calendarId): bool
    {
        return in_array($calendarId, $this->dismissedCalendarIds($username), true);
    }

    public function dismiss(string $username, int $calendarId): void
    {
        CalendarShareDismissal::query()->updateOrCreate(
            ['username' => $username, 'calendarid' => $calendarId],
            ['dismissed_at' => now()],
        );
    }

    public function restore(string $username, int $calendarId): void
    {
        CalendarShareDismissal::query()
            ->where('username', $username)
            ->where('calendarid', $calendarId)
            ->delete();
    }

    /**
     * Drops sharee instances whose grant is hidden (the owner is a user who shares no Team with
     * the sharee, or left the Team the share went to), and the owner's own copy of a DM whose
     * peer is hidden, so a DM disappears for both people. Team-owned collections stay. The
     * answer does not depend on `$viewer`: a hidden grant is hidden for everyone.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function rejectHiddenSharees(string $viewer, Collection $instances): Collection
    {
        if ($instances->isEmpty()) {
            return $instances;
        }

        $owners = $this->ownerUrisByCalendar($instances);
        $dmPeers = $this->dmPeerUrisByCalendar($instances);

        return $instances
            ->filter(function (CalendarInstance $instance) use ($owners, $dmPeers): bool {
                $calendarId = (int) $instance->calendarid;
                if ($this->isShareeInstance($instance)) {
                    return $this->colleagues->grantIsVisible($owners[$calendarId] ?? null, (string) $instance->principaluri);
                }
                foreach ($dmPeers[$calendarId] ?? [] as $peerUri) {
                    if (! $this->colleagues->grantIsVisible((string) $instance->principaluri, $peerUri)) {
                        return false;
                    }
                }

                return true;
            })
            ->values();
    }

    /**
     * Of `$calendarIds` that `$granteePrincipalUri` holds as a sharee, the ones whose grant is
     * hidden. For the CalDAV home, which lists Sabre rows rather than models (one query).
     *
     * @param  list<int>  $calendarIds
     * @return list<int>
     */
    public function hiddenShareeCalendarIds(string $granteePrincipalUri, array $calendarIds): array
    {
        if ($calendarIds === []) {
            return [];
        }

        $hidden = [];
        foreach (CalendarInstance::query()
            ->whereIn('calendarid', $calendarIds)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->get(['calendarid', 'principaluri']) as $owner) {
            if (! $this->colleagues->grantIsVisible((string) $owner->principaluri, $granteePrincipalUri)) {
                $hidden[] = (int) $owner->calendarid;
            }
        }

        return $hidden;
    }

    /**
     * Both filters: what the user can list or open.
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function rejectInvisibleSharees(string $viewer, Collection $instances): Collection
    {
        return $this->rejectHiddenSharees($viewer, $this->rejectDismissedSharees($viewer, $instances));
    }

    /**
     * @param  Collection<int, CalendarInstance>  $instances
     * @return Collection<int, CalendarInstance>
     */
    public function rejectDismissedSharees(string $username, Collection $instances): Collection
    {
        $ids = $this->dismissedCalendarIds($username);
        if ($ids === []) {
            return $instances;
        }

        return $instances
            ->filter(function (CalendarInstance $instance) use ($ids): bool {
                $access = (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER);
                if ($access !== SharingPlugin::ACCESS_READ && $access !== SharingPlugin::ACCESS_READWRITE) {
                    return true;
                }

                return ! in_array((int) $instance->calendarid, $ids, true);
            })
            ->values();
    }

    private function isShareeInstance(CalendarInstance $instance): bool
    {
        $access = (int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER);

        return $access === SharingPlugin::ACCESS_READ || $access === SharingPlugin::ACCESS_READWRITE;
    }

    /**
     * Owner principal uri per calendar, for the sharee instances in `$instances` (one query).
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return array<int, string>
     */
    private function ownerUrisByCalendar(Collection $instances): array
    {
        $calendarIds = $instances
            ->filter(fn (CalendarInstance $instance): bool => $this->isShareeInstance($instance))
            ->map(static fn (CalendarInstance $instance): int => (int) $instance->calendarid)
            ->unique()
            ->values()
            ->all();
        if ($calendarIds === []) {
            return [];
        }

        $owners = [];
        foreach (CalendarInstance::query()
            ->whereIn('calendarid', $calendarIds)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->get(['calendarid', 'principaluri']) as $owner) {
            $owners[(int) $owner->calendarid] = (string) $owner->principaluri;
        }

        return $owners;
    }

    /**
     * Sharee principal uris per calendar for the owner copies of DMs in `$instances` (one query).
     *
     * @param  Collection<int, CalendarInstance>  $instances
     * @return array<int, list<string>>
     */
    private function dmPeerUrisByCalendar(Collection $instances): array
    {
        $calendarIds = $instances
            ->filter(fn (CalendarInstance $instance): bool => ! $this->isShareeInstance($instance)
                && str_starts_with((string) $instance->uri, ChatCollectionUris::PREFIX_DM))
            ->map(static fn (CalendarInstance $instance): int => (int) $instance->calendarid)
            ->unique()
            ->values()
            ->all();
        if ($calendarIds === []) {
            return [];
        }

        $peers = [];
        foreach (CalendarInstance::query()
            ->whereIn('calendarid', $calendarIds)
            ->whereIn('access', [SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE])
            ->whereNotNull('principaluri')
            ->get(['calendarid', 'principaluri']) as $peer) {
            $peers[(int) $peer->calendarid][] = (string) $peer->principaluri;
        }

        return $peers;
    }
}
