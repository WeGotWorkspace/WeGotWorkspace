<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Shared CalDAV collection ACL: list accessible instances, dedupe owner vs
 * inbound sharee, sharee name/color PATCH, dismiss-on-delete, and item writes.
 * Calendar passes {@see Calendar::scopeSupportsVevent()}; Tasks
 * passes {@see Calendar::scopeVtodoOnly()}; Notes passes
 * {@see Calendar::scopeVjournalOnly()}.
 */
final class CalendarCollectionAccess
{
    public function __construct(
        private readonly DriveGroupResolver $groups,
        private readonly CalendarShareInvites $shareInvites,
        private readonly CalendarShareVisibility $shareVisibility,
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
    ) {}

    /**
     * Personal + group + inbound sharee instances for $username, filtered by
     * component set, then highest-access-per-calendarid, then dismissals.
     *
     * @param  callable(Builder): void  $componentQuery
     * @return Collection<int, CalendarInstance>
     */
    public function accessibleInstances(string $username, callable $componentQuery)
    {
        $instances = $this->personalInstances($username, $componentQuery);
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            foreach ($this->groupInstances($slug, $componentQuery) as $groupInstance) {
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

    /** Hide an inbound share. Returns true when the instance was a sharee. */
    public function dismissIfSharee(string $username, CalendarInstance $instance): bool
    {
        if (! $this->shareInvites->isSharee($instance)) {
            return false;
        }

        $this->shareVisibility->dismiss($username, (int) $instance->calendarid);

        return true;
    }

    /**
     * @param  callable(Builder): void  $componentQuery
     * @return Collection<int, CalendarInstance>
     */
    private function personalInstances(string $username, callable $componentQuery)
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $this->principalUri($username))
            ->whereHas('calendar', $componentQuery)
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get();
    }

    /**
     * @param  callable(Builder): void  $componentQuery
     * @return list<CalendarInstance>
     */
    private function groupInstances(string $groupSlug, callable $componentQuery): array
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
            ->whereHas('calendar', $componentQuery)
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all();
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }
}
