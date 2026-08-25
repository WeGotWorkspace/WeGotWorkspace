<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarShareDismissal;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Per-user hide of an inbound share. Does not change the owner's shareWith grant.
 * Restore is the inverse ({@see restore}) so a later "add again" UI does not
 * need a second storage model.
 */
final class CalendarShareVisibility
{
    /**
     * @return list<int>
     */
    public function dismissedCalendarIds(string $username): array
    {
        return CalendarShareDismissal::query()
            ->where('username', $username)
            ->pluck('calendarid')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
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
     * @param  iterable<int, CalendarInstance>  $instances
     * @return iterable<int, CalendarInstance>
     */
    public function rejectDismissedSharees(string $username, $instances)
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
}
