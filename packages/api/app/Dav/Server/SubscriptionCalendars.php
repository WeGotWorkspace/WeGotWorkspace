<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Models\CalendarInstance;
use App\Models\CalendarSubscription;
use App\Services\Admin\AdminConstants;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Tells whether a calendar is a feed subscription (#2370). The feed refresh owns
 * every event in one, so nothing may change it over CalDAV: the next refresh
 * would delete the change as stale.
 *
 * A subscription is the calendar a `calendar_subscriptions` row names, found on
 * the owner's instance: under the subscriber's own principal, or under the Team
 * principal when the subscriber made it into a Team collection (the subscriber
 * then has no personal instance of that uri). Sharee copies resolve through
 * the calendar's owner instance.
 */
final class SubscriptionCalendars
{
    /** @var array<int, bool> */
    private array $byCalendarId = [];

    public function isSubscription(int $calendarId): bool
    {
        return $this->byCalendarId[$calendarId] ??= $this->resolve($calendarId);
    }

    private function resolve(int $calendarId): bool
    {
        $owner = CalendarInstance::query()
            ->where('calendarid', $calendarId)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->first(['principaluri', 'uri']);
        if ($owner === null || (string) $owner->uri === '') {
            return false;
        }

        $ownerUri = (string) $owner->principaluri;
        $isTeam = str_starts_with($ownerUri, AdminConstants::GROUP_PREFIX);
        foreach (CalendarSubscription::query()->where('calendar_uri', (string) $owner->uri)->pluck('username') as $subscriber) {
            $personal = 'principals/'.$subscriber;
            if ($personal === $ownerUri) {
                return true;
            }
            if ($isTeam && ! CalendarInstance::query()->where('principaluri', $personal)->where('uri', (string) $owner->uri)->exists()) {
                return true;
            }
        }

        return false;
    }
}
