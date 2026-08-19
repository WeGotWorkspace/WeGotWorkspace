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
            $email = $this->addresses->calendarUserAddress($row->email)
                ?? $this->addresses->calendarUserAddress($username);
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
            $list[] = $this->toNotification($username, $row);
        }

        return ['list' => $list];
    }

    /**
     * @param  array{participationStatus: string}  $payload
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
        $updated = false;
        foreach ($participants as $id => $participant) {
            if (! is_array($participant)) {
                continue;
            }
            if (! $this->isOwnParticipant($username, $participant['email'] ?? null)) {
                continue;
            }
            $participant['participationStatus'] = $status;
            $participants[$id] = $participant;
            $updated = true;
        }
        if (! $updated) {
            throw new ApiHttpException(400, 'You are not an attendee of this event.', 'bad_request');
        }

        $this->events->patchWithPrecondition($username, $eventId, [
            'participants' => $participants,
        ], requirePrecondition: false);
        $row->delete();

        $notification['participationStatus'] = $status;

        return $notification;
    }

    public function dismiss(string $username, string $notificationId): void
    {
        $this->ownedOrNotFound($username, $notificationId)->delete();
    }

    private function ownedOrNotFound(string $username, string $notificationId): SchedulingObject
    {
        $row = SchedulingObject::query()
            ->where('principaluri', $this->principalUri($username))
            ->where('uri', $notificationId)
            ->first();
        if ($row === null) {
            throw new ApiHttpException(404, 'Scheduling notification not found.', 'not_found');
        }

        return $row;
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
            'etag' => (string) $row->etag,
        ];
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
