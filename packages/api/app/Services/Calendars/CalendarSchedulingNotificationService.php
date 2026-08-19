<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Principal;
use App\Models\SchedulingObject;
use App\Services\MailDelivery\MailDeliveryService;
use App\Services\MailDelivery\MailDeliveryTransportResolver;
use DateTimeInterface;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;

/**
 * Own-inbox scheduling notifications (RFC 6638 {@code schedulingobjects}).
 */
final class CalendarSchedulingNotificationService
{
    private const RESPOND_METHODS = ['REQUEST'];

    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly CalendarEventRepository $events,
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarRepository $calendars,
        private readonly MailDeliveryService $mail,
        private readonly MailDeliveryTransportResolver $mailResolver,
        private readonly CalendarSchedulingInviteHorizon $horizon,
        private readonly CalendarSchedulingRsvpScope $rsvpScope,
    ) {}

    /**
     * @return array{list: list<array{username: string, email: string, name: string}>, canSubmitEmail: bool}
     */
    public function invitees(): array
    {
        $rows = Principal::query()
            ->where('uri', 'like', 'principals/%')
            ->where('uri', 'not like', 'principals/groups/%')
            ->orderBy('uri')
            ->get();

        $list = [];
        foreach ($rows as $row) {
            $username = str_starts_with((string) $row->uri, 'principals/')
                ? substr((string) $row->uri, strlen('principals/'))
                : (string) $row->uri;
            if ($username === '' || str_contains($username, '/')) {
                continue;
            }
            $email = $this->addresses->canonicalCalendarUserAddress($row);
            if ($email === null) {
                continue;
            }
            $name = trim((string) ($row->displayname ?? ''));
            $list[] = [
                'username' => $username,
                'email' => $email,
                'name' => $name !== '' ? $name : $username,
            ];
        }

        $capability = $this->mailResolver->capability($this->mail->loadConfig());

        return [
            'list' => $list,
            'canSubmitEmail' => (bool) ($capability['canSubmit'] ?? false),
        ];
    }

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username): array
    {
        $rows = SchedulingObject::query()
            ->where('principaluri', $this->principalUri($username))
            ->orderBy('id')
            ->get();

        $list = [];
        foreach ($rows as $row) {
            $notification = $this->toNotification($username, $row);
            if ($this->isOrganizerInboxItem($username, $notification, $row)) {
                continue;
            }
            if ($this->isStaleInvite($username, $notification, $row)) {
                $row->delete();

                continue;
            }
            if ($this->isFullyPastInvite($row)) {
                continue;
            }
            $list[] = ['row' => $row, 'notification' => $notification];
        }

        return ['list' => $this->collapseDuplicateInvites($list)];
    }

    /**
     * One invitee-facing card per UID. Extra REQUEST copies (reschedule,
     * timezone rewrite, series instances) are dropped; the newest row remains.
     *
     * @param  list<array{row: SchedulingObject, notification: array<string, mixed>}>  $items
     * @return list<array<string, mixed>>
     */
    private function collapseDuplicateInvites(array $items): array
    {
        $keepIndexByUid = [];
        $drop = [];
        foreach ($items as $index => $item) {
            $uid = trim((string) ($item['notification']['uid'] ?? ''));
            $method = strtoupper((string) ($item['notification']['method'] ?? 'REQUEST'));
            if ($uid === '' || ($method !== '' && $method !== 'REQUEST')) {
                continue;
            }
            if (! isset($keepIndexByUid[$uid])) {
                $keepIndexByUid[$uid] = $index;

                continue;
            }
            $previous = $keepIndexByUid[$uid];
            $preferCurrent = (int) $item['row']->id >= (int) $items[$previous]['row']->id;
            $drop[] = $preferCurrent ? $previous : $index;
            if ($preferCurrent) {
                $keepIndexByUid[$uid] = $index;
            }
        }
        foreach ($drop as $index) {
            $items[$index]['row']->delete();
            unset($items[$index]);
        }

        $list = [];
        foreach ($items as $item) {
            $list[] = $item['notification'];
        }

        return $list;
    }

    /**
     * @param  array{participationStatus: string, calendarId?: string|null, recurrenceId?: string|null, scope?: string|null}  $payload
     * @return array<string, mixed>
     */
    public function respond(string $username, string $notificationId, array $payload): array
    {
        $row = $this->ownedOrNotFound($username, $notificationId);
        $notification = $this->toNotification($username, $row);
        $method = strtoupper((string) ($notification['method'] ?? ''));
        if (! in_array($method, self::RESPOND_METHODS, true)) {
            throw new ApiHttpException(400, 'Only REQUEST notifications can be answered.', 'bad_request');
        }

        $eventId = $notification['eventId'] ?? null;
        if (! is_string($eventId) || $eventId === '') {
            throw new ApiHttpException(404, 'Calendar event not found.', 'not_found');
        }

        $status = $payload['participationStatus'];
        $event = $this->events->show($username, $eventId);
        $participants = is_array($event['participants'] ?? null) ? $event['participants'] : [];
        $isOwn = fn (mixed $email): bool => $this->isOwnParticipant($username, $email);
        if (! $this->hasOwnParticipant($participants, $isOwn)) {
            throw new ApiHttpException(400, 'You are not an attendee of this event.', 'bad_request');
        }

        $copy = is_string($notification['uid'] ?? null) && $notification['uid'] !== ''
            ? $this->findEventByUid($username, (string) $notification['uid'])
            : null;
        $ics = $copy !== null
            ? (is_string($copy->calendardata) ? $copy->calendardata : (string) $copy->calendardata)
            : null;

        $patch = $this->rsvpScope->patch(
            $event,
            $status,
            isset($payload['scope']) && is_string($payload['scope']) ? $payload['scope'] : null,
            isset($payload['recurrenceId']) && is_string($payload['recurrenceId']) ? $payload['recurrenceId'] : null,
            $payload['calendarId'] ?? null,
            $isOwn,
            $ics,
        );

        $this->events->patchWithPrecondition($username, $eventId, $patch, requirePrecondition: false);
        $notification['participationStatus'] = $status;

        return $notification;
    }

    public function dismiss(string $username, string $notificationId): void
    {
        $this->ownedOrNotFound($username, $notificationId)->delete();
    }

    /**
     * This REST inbox is invitee-only. Organizer rows (REQUEST/REPLY/CANCEL, self-as-attendee
     * aliases, missing METHOD, or missing ORGANIZER on an outbound copy) stay out.
     *
     * @param  array<string, mixed>  $notification
     */
    private function isOrganizerInboxItem(string $username, array $notification, ?SchedulingObject $row): bool
    {
        if ($this->isOwnParticipant($username, $notification['organizerEmail'] ?? null)) {
            return true;
        }

        $vevent = $row !== null ? $this->veventFromSchedulingObject($row) : null;
        if ($vevent instanceof VEvent && isset($vevent->ORGANIZER)) {
            return $this->isOwnParticipant($username, (string) $vevent->ORGANIZER);
        }

        if ($vevent instanceof VEvent && $this->isListedAttendee($username, $vevent)) {
            return false;
        }

        $eventId = $notification['eventId'] ?? null;
        if (! is_string($eventId) || $eventId === '') {
            return $vevent instanceof VEvent && ! $this->isListedAttendee($username, $vevent);
        }

        try {
            $event = $this->events->show($username, $eventId);
        } catch (\Throwable) {
            return false;
        }

        return $this->userOwnsEvent($username, $event);
    }

    /**
     * @param  array<string, mixed>  $notification
     */
    private function isStaleInvite(string $username, array $notification, SchedulingObject $row): bool
    {
        $method = strtoupper((string) ($notification['method'] ?? ''));
        if ($method === 'CANCEL') {
            $this->deleteInboxForUid($username, (string) ($notification['uid'] ?? ''));

            return true;
        }
        if ($method !== 'REQUEST') {
            return false;
        }

        $eventId = $notification['eventId'] ?? null;
        if (! is_string($eventId) || $eventId === '') {
            return $this->organizerEventMissing($username, $row);
        }

        return $this->eventCopyIsCancelled($username, $eventId)
            || $this->organizerEventMissing($username, $row);
    }

    /**
     * Hide invites whose event is entirely in the past (one-off ended, or
     * recurring series with no remaining instances after now). Applies to New
     * and Responded so the inbox badge stays aligned with the sidebar.
     */
    private function isFullyPastInvite(SchedulingObject $row): bool
    {
        $vevent = $this->veventFromSchedulingObject($row);

        return $vevent instanceof VEvent
            && ! $this->horizon->continuesAfter($vevent, now()->toDateTimeImmutable());
    }

    private function ownedOrNotFound(string $username, string $notificationId): SchedulingObject
    {
        $row = SchedulingObject::query()
            ->where('principaluri', $this->principalUri($username))
            ->where('uri', $notificationId)
            ->first();
        if ($row !== null) {
            return $row;
        }

        $synthetic = $this->syntheticSchedulingObject($username, $notificationId);
        if ($synthetic !== null) {
            return $synthetic;
        }

        throw new ApiHttpException(404, 'Scheduling notification not found.', 'not_found');
    }

    /**
     * @return array<string, mixed>
     */
    private function toNotification(string $username, SchedulingObject $row): array
    {
        $raw = is_string($row->calendardata) ? $row->calendardata : (string) $row->calendardata;
        $vcal = Reader::read($raw);
        $vevent = $vcal->VEVENT ?? null;
        $method = strtoupper(trim((string) ($vcal->METHOD ?? 'REQUEST')));
        $uid = $vevent instanceof VEvent ? trim((string) ($vevent->UID ?? '')) : '';
        $copy = $uid !== '' ? $this->findEventByUid($username, $uid) : null;

        return [
            'id' => (string) $row->uri,
            'uid' => $uid,
            'method' => $method,
            'title' => $vevent instanceof VEvent ? trim((string) ($vevent->SUMMARY ?? '')) : '',
            'organizerEmail' => $vevent instanceof VEvent ? $this->organizerEmail($vevent) : null,
            'organizerName' => $vevent instanceof VEvent ? $this->organizerName($vevent) : null,
            'start' => $vevent instanceof VEvent ? $this->dateProperty($vevent, 'DTSTART') : null,
            'end' => $vevent instanceof VEvent ? $this->dateProperty($vevent, 'DTEND') : null,
            'participationStatus' => $this->ownPartstat($username, $vevent, $copy),
            'eventId' => $copy !== null
                ? CalendarEventMapper::eventIdFromUri((string) $copy->uri)
                : null,
            'location' => $vevent instanceof VEvent ? $this->location($vevent) : null,
            'recurring' => $vevent instanceof VEvent && $this->isRecurring($vevent),
            'etag' => (string) $row->etag,
        ];
    }

    private function schedulingObjectFromCalendarCopy(CalendarObject $copy): SchedulingObject
    {
        $raw = is_string($copy->calendardata) ? $copy->calendardata : (string) $copy->calendardata;
        $row = new SchedulingObject;
        $row->uri = CalendarEventMapper::eventIdFromUri((string) $copy->uri);
        $row->calendardata = $raw;
        $row->etag = (string) $copy->etag;

        return $row;
    }

    private function syntheticSchedulingObject(string $username, string $notificationId): ?SchedulingObject
    {
        try {
            $event = $this->events->show($username, $notificationId);
        } catch (\Throwable) {
            return null;
        }
        if ($this->userOwnsEvent($username, $event)) {
            return null;
        }
        $uid = is_string($event['uid'] ?? null) ? $event['uid'] : '';
        $copy = $uid !== '' ? $this->findEventByUid($username, $uid) : null;
        if ($copy === null) {
            return null;
        }

        return $this->schedulingObjectFromCalendarCopy($copy);
    }

    private function veventFromSchedulingObject(SchedulingObject $row): ?VEvent
    {
        $raw = is_string($row->calendardata) ? $row->calendardata : (string) $row->calendardata;
        try {
            $vcal = Reader::read($raw);
        } catch (\Throwable) {
            return null;
        }
        $vevent = $vcal->VEVENT ?? null;

        return $vevent instanceof VEvent ? $vevent : null;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function userOwnsEvent(string $username, array $event): bool
    {
        foreach ($event['participants'] ?? [] as $participant) {
            if (! is_array($participant)) {
                continue;
            }
            $roles = $participant['roles'] ?? null;
            $isOwner = is_array($roles) && (isset($roles['owner']) || in_array('owner', $roles, true));
            if (! $isOwner) {
                continue;
            }
            if ($this->isOwnParticipant($username, $participant['email'] ?? null)) {
                return true;
            }
        }

        return false;
    }

    private function isListedAttendee(string $username, VEvent $vevent): bool
    {
        if (! isset($vevent->ATTENDEE)) {
            return false;
        }
        foreach ($vevent->ATTENDEE as $attendee) {
            if ($this->isOwnParticipant($username, (string) $attendee)) {
                return true;
            }
        }

        return false;
    }

    private function eventCopyIsCancelled(string $username, string $eventId): bool
    {
        try {
            $event = $this->events->show($username, $eventId);
        } catch (\Throwable) {
            return false;
        }
        $status = strtolower((string) ($event['status'] ?? ''));

        return $status === 'cancelled';
    }

    private function organizerEventMissing(string $username, SchedulingObject $row): bool
    {
        $vevent = $this->veventFromSchedulingObject($row);
        if (! $vevent instanceof VEvent || ! isset($vevent->ORGANIZER)) {
            return false;
        }
        $organizer = $this->addresses->principalForMailto((string) $vevent->ORGANIZER);
        if ($organizer === null) {
            return false;
        }
        $uid = trim((string) ($vevent->UID ?? ''));
        if ($uid === '') {
            return false;
        }
        $organizerUsername = str_starts_with((string) $organizer->uri, 'principals/')
            ? substr((string) $organizer->uri, strlen('principals/'))
            : (string) $organizer->uri;
        if ($organizerUsername === $username) {
            return false;
        }

        return $this->findEventByUid($organizerUsername, $uid) === null;
    }

    private function deleteInboxForUid(string $username, string $uid): void
    {
        if ($uid === '') {
            return;
        }
        $rows = SchedulingObject::query()
            ->where('principaluri', $this->principalUri($username))
            ->get();
        foreach ($rows as $row) {
            $vevent = $this->veventFromSchedulingObject($row);
            if ($vevent instanceof VEvent && trim((string) ($vevent->UID ?? '')) === $uid) {
                $row->delete();
            }
        }
    }

    private function location(VEvent $vevent): ?string
    {
        if (! isset($vevent->LOCATION)) {
            return null;
        }
        $location = trim((string) $vevent->LOCATION);

        return $location !== '' ? $location : null;
    }

    private function isRecurring(VEvent $vevent): bool
    {
        return isset($vevent->RRULE) || isset($vevent->{'RECURRENCE-ID'});
    }

    private function findEventByUid(string $username, string $uid): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('uid', $uid)
            ->whereHas('calendar.instances', function ($query) use ($username): void {
                $query->where('principaluri', $this->principalUri($username));
            })
            ->first();
    }

    /**
     * @return 'needs-action'|'accepted'|'tentative'|'declined'|'delegated'
     */
    private function ownPartstat(string $username, mixed $vevent, ?CalendarObject $copy): string
    {
        if ($copy !== null) {
            $instance = CalendarInstance::query()
                ->where('calendarid', (int) $copy->calendarid)
                ->where('principaluri', $this->principalUri($username))
                ->first();
            if ($instance !== null) {
                $event = $this->mapper->toCalendarEvent(
                    $copy,
                    $this->calendars->apiIdForInstance($instance),
                    null,
                    $username,
                );
                foreach ($event['participants'] ?? [] as $participant) {
                    if (! is_array($participant)) {
                        continue;
                    }
                    if (! $this->isOwnParticipant($username, $participant['email'] ?? null)) {
                        continue;
                    }
                    $status = strtolower((string) ($participant['participationStatus'] ?? 'needs-action'));

                    return $this->normalizePartstat($status);
                }
            }
        }

        if ($vevent instanceof VEvent && isset($vevent->ATTENDEE)) {
            foreach ($vevent->ATTENDEE as $attendee) {
                if (! $this->isOwnParticipant($username, (string) $attendee)) {
                    continue;
                }
                $status = strtolower(trim((string) ($attendee['PARTSTAT'] ?? 'NEEDS-ACTION')));

                return $this->normalizePartstat($status);
            }
        }

        return 'needs-action';
    }

    /**
     * @param  array<string, mixed>  $participants
     * @param  callable(mixed): bool  $isOwn
     */
    private function hasOwnParticipant(array $participants, callable $isOwn): bool
    {
        foreach ($participants as $participant) {
            if (is_array($participant) && $isOwn($participant['email'] ?? null)) {
                return true;
            }
        }

        return false;
    }

    private function isOwnParticipant(string $username, mixed $participantEmail): bool
    {
        $candidate = $this->addresses->calendarUserAddress($participantEmail);
        foreach ($this->addresses->addressesForUsername($username) as $address) {
            if ($this->addresses->calendarUserAddress($address) === $candidate && $candidate !== null) {
                return true;
            }
        }
        $principal = is_string($participantEmail) || $participantEmail === null
            ? $this->addresses->principalForMailto((string) ($participantEmail ?? ''))
            : null;

        return $principal !== null && $principal->uri === $this->principalUri($username);
    }

    private function organizerEmail(VEvent $vevent): ?string
    {
        if (! isset($vevent->ORGANIZER)) {
            return null;
        }

        return $this->addresses->normalizedEmail((string) $vevent->ORGANIZER);
    }

    private function organizerName(VEvent $vevent): ?string
    {
        if (! isset($vevent->ORGANIZER['CN'])) {
            return null;
        }
        $name = trim((string) $vevent->ORGANIZER['CN']);

        return $name !== '' ? $name : null;
    }

    private function dateProperty(VEvent $vevent, string $name): ?string
    {
        if (! isset($vevent->{$name})) {
            return null;
        }
        try {
            $date = $vevent->{$name}->getDateTime();
        } catch (\Throwable) {
            return null;
        }
        if (! $date instanceof DateTimeInterface) {
            return null;
        }

        return $date->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    /**
     * @return 'needs-action'|'accepted'|'tentative'|'declined'|'delegated'
     */
    private function normalizePartstat(string $status): string
    {
        $normalized = str_replace('_', '-', strtolower($status));

        return match ($normalized) {
            'accepted' => 'accepted',
            'tentative' => 'tentative',
            'declined' => 'declined',
            'delegated' => 'delegated',
            default => 'needs-action',
        };
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }
}
