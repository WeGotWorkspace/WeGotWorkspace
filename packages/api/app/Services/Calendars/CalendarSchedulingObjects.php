<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use Illuminate\Support\Collection;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;

/**
 * Resolves scheduling objects by UID inside calendars a principal owns.
 *
 * A UID is not a secret and not unique across users: every invite, feed and
 * import carries it. Lookups that write back therefore check the ORGANIZER of
 * what they find and never search a read-only share. Attendee copies (iTIP
 * REQUEST/CANCEL delivery, inbox RSVP) only use owner instances; the
 * organizer's event (REPLY, guest RSVP links) falls back to calendars shared
 * to the organizer with write access, where an invite can be organized.
 */
final class CalendarSchedulingObjects
{
    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarSchedulingDeliveryPolicy $policy,
    ) {}

    /**
     * Objects with $uid in calendars $principalUri owns, lowest id first.
     * This is the set Sabre's own local delivery consults.
     *
     * @return Collection<int, array{object: CalendarObject, instance: CalendarInstance}>
     */
    public function ownedByPrincipal(string $principalUri, string $uid): Collection
    {
        return $this->ownedByPrincipals([$principalUri], $uid);
    }

    /**
     * The user's own invite copy: personal calendars first, then calendars of
     * the user's groups. The copy must name someone else as ORGANIZER, and a
     * group calendar object that is the organizer's own event is skipped.
     *
     * @return array{object: CalendarObject, instance: CalendarInstance}|null
     */
    public function attendeeCopy(string $username, string $uid): ?array
    {
        if ($uid === '') {
            return null;
        }
        $principalUris = $this->calendars->accessiblePrincipalUris($username);
        $personal = array_shift($principalUris);
        $userPrincipal = 'principals/'.$username;

        foreach ($this->ownedByPrincipals([(string) $personal], $uid) as $candidate) {
            if ($this->isInviteCopyFor($candidate['object'], $userPrincipal)) {
                return $candidate;
            }
        }

        foreach ($this->ownedByPrincipals($principalUris, $uid) as $candidate) {
            if (! $this->isInviteCopyFor($candidate['object'], $userPrincipal)) {
                continue;
            }
            $organizer = $this->policy->organizerPrincipalUri($this->parse($candidate['object']));
            $organizerEvent = $organizer !== null
                ? $this->organizerEvent(substr($organizer, strlen('principals/')), $uid)
                : null;
            if ($organizerEvent !== null && $organizerEvent['object']->is($candidate['object'])) {
                continue;
            }

            return $candidate;
        }

        return null;
    }

    /**
     * The organizer's event: an object whose ORGANIZER is $username, in the
     * organizer's personal calendars first, then the organizer's group
     * calendars (invites may be organized from a group calendar), then
     * calendars shared to the organizer or their groups with write access
     * (an invite organized there). Read-only shares are never searched.
     *
     * @return array{object: CalendarObject, instance: CalendarInstance}|null
     */
    public function organizerEvent(string $username, string $uid): ?array
    {
        if ($uid === '' || $username === '' || str_contains($username, '/')) {
            return null;
        }
        $principalUris = $this->calendars->accessiblePrincipalUris($username);
        $personal = array_shift($principalUris);
        $userPrincipal = 'principals/'.$username;

        $allPrincipals = [(string) $personal, ...$principalUris];
        $tiers = [
            fn (): Collection => $this->ownedByPrincipals([(string) $personal], $uid),
            fn (): Collection => $this->ownedByPrincipals($principalUris, $uid),
            fn (): Collection => $this->objectsInInstances($allPrincipals, $uid, [SharingPlugin::ACCESS_READWRITE], false),
        ];
        foreach ($tiers as $tier) {
            foreach ($tier() as $candidate) {
                if ($this->policy->organizerPrincipalUri($this->parse($candidate['object'])) === $userPrincipal) {
                    return $candidate;
                }
            }
        }

        return null;
    }

    public function parse(CalendarObject $object): ?VCalendar
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : '';
        if ($raw === '') {
            return null;
        }
        try {
            $parsed = Reader::read($raw);
        } catch (\Throwable) {
            return null;
        }

        return $parsed instanceof VCalendar ? $parsed : null;
    }

    private function isInviteCopyFor(CalendarObject $object, string $userPrincipal): bool
    {
        $calendar = $this->parse($object);

        return $calendar !== null
            && $this->policy->organizers($calendar) !== []
            && $this->policy->organizerPrincipalUri($calendar) !== $userPrincipal;
    }

    /**
     * @param  list<string>  $principalUris
     * @return Collection<int, array{object: CalendarObject, instance: CalendarInstance}>
     */
    private function ownedByPrincipals(array $principalUris, string $uid): Collection
    {
        return $this->objectsInInstances($principalUris, $uid, [SharingPlugin::ACCESS_SHAREDOWNER], true);
    }

    /**
     * @param  list<string>  $principalUris
     * @param  list<int>  $accessLevels
     * @return Collection<int, array{object: CalendarObject, instance: CalendarInstance}>
     */
    private function objectsInInstances(array $principalUris, string $uid, array $accessLevels, bool $includeNullAccess): Collection
    {
        if ($uid === '' || $principalUris === []) {
            return collect();
        }
        $instances = CalendarInstance::query()
            ->whereIn('principaluri', $principalUris)
            ->where(function ($query) use ($accessLevels, $includeNullAccess): void {
                $query->whereIn('access', $accessLevels);
                if ($includeNullAccess) {
                    $query->orWhereNull('access');
                }
            })
            ->get()
            ->keyBy(static fn (CalendarInstance $instance): int => (int) $instance->calendarid);
        if ($instances->isEmpty()) {
            return collect();
        }

        return CalendarObject::query()
            ->where('uid', $uid)
            ->whereIn('calendarid', $instances->keys()->all())
            ->orderBy('id')
            ->get()
            ->map(static fn (CalendarObject $object): array => [
                'object' => $object,
                'instance' => $instances->get((int) $object->calendarid),
            ])
            ->filter(static fn (array $row): bool => $row['instance'] instanceof CalendarInstance)
            ->values();
    }
}
