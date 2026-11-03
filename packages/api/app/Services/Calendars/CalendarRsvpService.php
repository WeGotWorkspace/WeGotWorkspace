<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\CalendarRsvpToken;

final class CalendarRsvpService
{
    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly CalendarEventRepository $events,
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarRepository $calendars,
        private readonly CalendarRsvpRateLimiter $rateLimiter,
        private readonly CalendarSchedulingObjects $objects,
    ) {}

    /**
     * @return array{title: string, attendeeEmail: string, participationStatus: string}
     */
    public function show(string $token, string $ip): array
    {
        $row = $this->validToken($token, $ip);

        return $this->summary($row, $this->findOrganizerEvent($row));
    }

    /**
     * @param  array{participationStatus: string}  $payload
     * @return array{title: string, attendeeEmail: string, participationStatus: string}
     */
    public function respond(string $token, array $payload, string $ip): array
    {
        $row = $this->validToken($token, $ip);
        $status = $payload['participationStatus'];
        if (is_string($row->used_partstat) && $row->used_partstat === $status) {
            return $this->show($token, $ip);
        }

        $event = $this->findOrganizerEvent($row);
        if ($event === null) {
            throw new ApiHttpException(404, 'Calendar event not found.', 'not_found');
        }

        $eventId = CalendarEventMapper::eventIdFromUri((string) $event['object']->uri);
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

        // Same token check as show(), so an answer still counts as a second attempt.
        return $this->summary($this->validToken($token, $ip), $event);
    }

    /**
     * @param  array{object: CalendarObject, instance: CalendarInstance}|null  $event
     * @return array{title: string, attendeeEmail: string, participationStatus: string}
     */
    private function summary(CalendarRsvpToken $row, ?array $event): array
    {
        return [
            'title' => $this->eventTitle($row, $event),
            'attendeeEmail' => (string) $row->attendee_email,
            'participationStatus' => (string) ($row->used_partstat ?? 'needs-action'),
        ];
    }

    private function validToken(string $token, string $ip): CalendarRsvpToken
    {
        if (! $this->rateLimiter->allow($ip, $token)) {
            throw new ApiHttpException(429, 'Too many attempts. Please try again later.', 'throttled');
        }

        $row = CalendarRsvpToken::findByRawToken($token);
        if ($row === null || (int) $row->expires_at < time()) {
            throw new ApiHttpException(404, 'RSVP link is invalid or expired.', 'not_found');
        }

        return $row;
    }

    /**
     * The event the organizer organizes with this UID: the organizer's own,
     * then group, then write-shared calendars. Read-only shares are skipped.
     *
     * @return array{object: CalendarObject, instance: CalendarInstance}|null
     */
    private function findOrganizerEvent(CalendarRsvpToken $row): ?array
    {
        return $this->objects->organizerEvent((string) $row->organizer_username, (string) $row->event_uid);
    }

    /**
     * @param  array{object: CalendarObject, instance: CalendarInstance}|null  $event
     */
    private function eventTitle(CalendarRsvpToken $row, ?array $event): string
    {
        if ($event === null) {
            return 'Invitation';
        }
        $payload = $this->mapper->toCalendarEvent(
            $event['object'],
            $this->calendars->apiIdForInstance($event['instance']),
            null,
            (string) $row->organizer_username,
        );

        return is_string($payload['title'] ?? null) && $payload['title'] !== ''
            ? $payload['title']
            : 'Invitation';
    }
}
