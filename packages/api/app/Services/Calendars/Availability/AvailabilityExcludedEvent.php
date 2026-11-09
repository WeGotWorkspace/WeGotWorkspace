<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Services\Calendars\CalendarEventMapper;
use App\Services\Calendars\CalendarEventMutationSupport;
use App\Services\Calendars\CalendarPrincipalAddresses;
use App\Services\Calendars\CalendarRepository;

/**
 * Resolves `excludeEventId` to the event's UID. Only an event the caller may
 * edit, or one the caller organizes or attends, qualifies: on a read-only
 * shared calendar, comparing results with and without the exclusion would
 * tell the caller whether a teammate holds that event.
 */
final class AvailabilityExcludedEvent
{
    public function __construct(
        private readonly CalendarEventMutationSupport $events,
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarRepository $calendars,
        private readonly CalendarPrincipalAddresses $addresses,
    ) {}

    /** The event's UID, or null when the id does not qualify. */
    public function uidFor(string $viewer, string $eventId): ?string
    {
        $located = $this->events->findOwnedEvent($viewer, $eventId);
        if ($located === null) {
            return null;
        }

        try {
            $event = $this->mapper->toCalendarEvent($located['object'], $located['calendarUri'], $located['veventUid']);
        } catch (\Throwable) {
            return null;
        }
        $uid = is_string($event['uid'] ?? null) ? $event['uid'] : '';
        if ($uid === '') {
            return null;
        }

        $editable = $this->calendars->instanceMayWrite($located['instance'])
            && ! $this->calendars->isSubscriptionCalendar($viewer, $located['calendarUri']);

        return $editable || $this->takesPart($viewer, $event) ? $uid : null;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function takesPart(string $viewer, array $event): bool
    {
        $mine = array_map('strtolower', $this->addresses->addressesForUsername($viewer));
        $participants = is_array($event['participants'] ?? null) ? $event['participants'] : [];
        foreach ($participants as $participant) {
            $email = is_array($participant) ? strtolower(trim((string) ($participant['email'] ?? ''))) : '';
            if ($email !== '' && in_array('mailto:'.$email, $mine, true)) {
                return true;
            }
        }

        return false;
    }
}
