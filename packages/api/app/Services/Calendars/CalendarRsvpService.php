<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use App\Models\CalendarRsvpToken;

final class CalendarRsvpService
{
    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly CalendarEventRepository $events,
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarRepository $calendars,
    ) {}

    /**
     * @return array{title: string, attendeeEmail: string, participationStatus: string}
     */
    public function show(string $token): array
    {
        $row = $this->validToken($token);

        return [
            'title' => $this->eventTitle($row),
            'attendeeEmail' => (string) $row->attendee_email,
            'participationStatus' => (string) ($row->used_partstat ?? 'needs-action'),
        ];
    }

    /**
     * @param  array{participationStatus: string}  $payload
     * @return array{title: string, attendeeEmail: string, participationStatus: string}
     */
    public function respond(string $token, array $payload): array
    {
        $row = $this->validToken($token);
        $status = $payload['participationStatus'];
        if (is_string($row->used_partstat) && $row->used_partstat === $status) {
            return $this->show($token);
        }

        $event = $this->findOrganizerEvent($row);
        if ($event === null) {
            throw new ApiHttpException(404, 'Calendar event not found.', 'not_found');
        }

        $eventId = CalendarEventMapper::eventIdFromUri((string) $event->uri);
        $username = (string) $row->organizer_username;
        $current = $this->events->show($username, $eventId);
        $participants = is_array($current['participants'] ?? null) ? $current['participants'] : [];
        $email = $this->addresses->normalizedEmail($row->attendee_email);
        foreach ($participants as $id => $participant) {
            if (! is_array($participant)) {
                continue;
            }
            if ($this->addresses->normalizedEmail($participant['email'] ?? null) !== $email) {
                continue;
            }
            $participant['participationStatus'] = $status;
            $participants[$id] = $participant;
        }

        $this->events->patchWithPrecondition($username, $eventId, [
            'participants' => $participants,
        ], requirePrecondition: false);

        $row->used_partstat = $status;
        $row->save();

        return $this->show($token);
    }

    private function validToken(string $token): CalendarRsvpToken
    {
        $row = CalendarRsvpToken::query()->where('token', $token)->first();
        if ($row === null || (int) $row->expires_at < time()) {
            throw new ApiHttpException(404, 'RSVP link is invalid or expired.', 'not_found');
        }

        return $row;
    }

    private function findOrganizerEvent(CalendarRsvpToken $row): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('uid', (string) $row->event_uid)
            ->whereHas('calendar.instances', function ($query) use ($row): void {
                $query->where('principaluri', 'principals/'.$row->organizer_username);
            })
            ->first();
    }

    private function eventTitle(CalendarRsvpToken $row): string
    {
        $event = $this->findOrganizerEvent($row);
        if ($event === null) {
            return 'Invitation';
        }
        $instance = $event->calendar?->instances()
            ->where('principaluri', 'principals/'.$row->organizer_username)
            ->first();
        if ($instance === null) {
            return 'Invitation';
        }
        $payload = $this->mapper->toCalendarEvent(
            $event,
            $this->calendars->apiIdForInstance($instance),
            null,
            (string) $row->organizer_username,
        );

        return is_string($payload['title'] ?? null) && $payload['title'] !== ''
            ? $payload['title']
            : 'Invitation';
    }
}
