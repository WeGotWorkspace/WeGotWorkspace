<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\ITip\Message;

/**
 * Decides whether an incoming local iTIP message may change an object the
 * recipient already holds with the same UID (RFC 5546 / RFC 6638 delivery).
 *
 * - REQUEST and CANCEL come from an organizer: they only apply to the
 *   recipient's invite copy from that same organizer.
 * - REPLY comes from an attendee: it only applies to the recipient's own
 *   organized event, and only for an attendee already on that event.
 *
 * Anything else is refused and the existing object stays as it is. Used by
 * the REST/JMAP delivery and by the CalDAV Schedule plugin guard.
 */
final class CalendarSchedulingDeliveryPolicy
{
    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
    ) {}

    public function allows(Message $message, string $recipientPrincipalUri, ?VCalendar $existing): bool
    {
        if ($existing === null) {
            return true;
        }

        return match (strtoupper((string) $message->method)) {
            'REQUEST', 'CANCEL' => $this->isCopyFromOrganizer($existing, (string) $message->sender, $recipientPrincipalUri),
            'REPLY' => $this->organizerPrincipalUri($existing) === $recipientPrincipalUri
                && $this->listsAttendee($existing, (string) $message->sender),
            default => false,
        };
    }

    /**
     * ORGANIZER values of every VEVENT in the object.
     *
     * @return list<string>
     */
    public function organizers(VCalendar $calendar): array
    {
        $organizers = [];
        foreach ($calendar->select('VEVENT') as $vevent) {
            if (isset($vevent->ORGANIZER)) {
                $organizers[] = (string) $vevent->ORGANIZER;
            }
        }

        return $organizers;
    }

    /**
     * Principal uri of the local user who organizes the object, when every
     * ORGANIZER in it names that same user.
     */
    public function organizerPrincipalUri(?VCalendar $calendar): ?string
    {
        if ($calendar === null) {
            return null;
        }
        $principalUri = null;
        foreach ($this->organizers($calendar) as $organizer) {
            $principal = $this->addresses->principalForMailto($organizer);
            if ($principal === null || ($principalUri !== null && $principalUri !== (string) $principal->uri)) {
                return null;
            }
            $principalUri = (string) $principal->uri;
        }

        return $principalUri;
    }

    public function sameCalendarUser(string $left, string $right): bool
    {
        $leftAddress = $this->addresses->calendarUserAddress($left);
        if ($leftAddress !== null && $leftAddress === $this->addresses->calendarUserAddress($right)) {
            return true;
        }
        $leftPrincipal = $this->addresses->principalForMailto($left);
        $rightPrincipal = $this->addresses->principalForMailto($right);

        return $leftPrincipal !== null
            && $rightPrincipal !== null
            && (string) $leftPrincipal->uri === (string) $rightPrincipal->uri;
    }

    private function isCopyFromOrganizer(VCalendar $existing, string $sender, string $recipientPrincipalUri): bool
    {
        $organizers = $this->organizers($existing);
        if ($organizers === [] || $sender === '') {
            return false;
        }
        foreach ($organizers as $organizer) {
            if (! $this->sameCalendarUser($organizer, $sender)) {
                return false;
            }
        }

        return $this->organizerPrincipalUri($existing) !== $recipientPrincipalUri;
    }

    private function listsAttendee(VCalendar $calendar, string $sender): bool
    {
        if ($sender === '') {
            return false;
        }
        foreach ($calendar->select('VEVENT') as $vevent) {
            foreach ($vevent->select('ATTENDEE') as $attendee) {
                if ($this->sameCalendarUser((string) $attendee, $sender)) {
                    return true;
                }
            }
        }

        return false;
    }
}
