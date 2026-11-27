<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Models\CalendarInstance;
use App\Models\CalendarSubscription;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Tells whether a calendar is a feed subscription (#2370). The feed refresh owns
 * every event in one, so nothing may change it over CalDAV: the next refresh
 * would delete the change as stale.
 *
 * A subscription is the calendar a `calendar_subscriptions` row names by its
 * owning principal and uri (#2367), found on the owner's instance. The owner is
 * the subscriber, or the Team when the subscriber made it a Team collection.
 * Sharee copies resolve through the calendar's owner instance. Registered as a
 * scoped service, so the answers are cached for one request only.
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

        return CalendarSubscription::query()
            ->where('principal_uri', (string) $owner->principaluri)
            ->where('calendar_uri', (string) $owner->uri)
            ->exists();
    }
}
