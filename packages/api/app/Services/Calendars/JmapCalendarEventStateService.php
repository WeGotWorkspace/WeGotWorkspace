<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use App\Models\JmapCalendarEventState;
use Illuminate\Support\Str;

/**
 * Per-event JMAP state tokens backing CalendarEvent/set ifInState and the
 * destroy-expansion of /changes (mirrors JmapContactStateService).
 *
 * Rows are written on every REST read and write and intentionally survive
 * event destruction: /changes expands a destroyed object uri to every id a
 * REST client has ever been handed for it (see spec 429-calendar-jmap-parity).
 */
final class JmapCalendarEventStateService
{
    /**
     * @param  array<string, mixed>  $event
     * @return array<string, mixed>
     */
    public function attachStateToken(
        string $username,
        array $event,
        CalendarObject $object,
        string $calendarUri,
    ): array {
        $eventId = (string) ($event['id'] ?? '');
        if ($eventId === '') {
            return $event;
        }

        $state = $this->ensureStateRow($username, $eventId, $object, $calendarUri);
        $event['state'] = $state->state_token;

        return $event;
    }

    /**
     * Resolve JMAP ifInState to a CalDAV etag for If-Match.
     */
    public function resolveEtagForIfInState(string $username, string $eventId, string $ifInState): string
    {
        $row = JmapCalendarEventState::query()
            ->where('username', $username)
            ->where('event_id', $eventId)
            ->first();

        if ($row === null || $row->state_token !== $ifInState) {
            throw $this->stateMismatch();
        }

        $etag = is_string($row->etag) ? trim($row->etag) : '';
        if ($etag === '') {
            throw $this->stateMismatch();
        }

        return $etag;
    }

    /**
     * Every event id previously surfaced over REST for this object uri.
     *
     * @return list<string>
     */
    public function recordedEventIdsForObject(string $username, string $objectUri): array
    {
        return JmapCalendarEventState::query()
            ->where('username', $username)
            ->where('object_uri', $objectUri)
            ->pluck('event_id')
            ->map(static fn ($id): string => (string) $id)
            ->values()
            ->all();
    }

    /**
     * Every event id previously surfaced for any object in this calendar —
     * the destroyed-branch primitive for the JMAP envelope's account-wide
     * CalendarEvent/changes when a whole calendar disappeared since sinceState.
     *
     * @return list<string>
     */
    public function recordedEventIdsForCalendar(string $username, string $calendarUri): array
    {
        return JmapCalendarEventState::query()
            ->where('username', $username)
            ->where('calendar_uri', $calendarUri)
            ->pluck('event_id')
            ->map(static fn ($id): string => (string) $id)
            ->values()
            ->all();
    }

    /**
     * Ensures a state row exists and rotates state_token when the CalDAV etag changes (read path).
     */
    private function ensureStateRow(
        string $username,
        string $eventId,
        CalendarObject $object,
        string $calendarUri,
    ): JmapCalendarEventState {
        $row = JmapCalendarEventState::query()
            ->where('username', $username)
            ->where('event_id', $eventId)
            ->first();

        $rawEtag = is_string($object->etag) ? $object->etag : null;

        if ($row === null) {
            return JmapCalendarEventState::query()->create([
                'username' => $username,
                'event_id' => $eventId,
                'calendar_uri' => $calendarUri,
                'object_uri' => (string) $object->uri,
                'state_token' => $this->generateStateToken(),
                'etag' => $rawEtag,
            ]);
        }

        if ($rawEtag !== null && $rawEtag !== '' && $row->etag !== $rawEtag) {
            $row->etag = $rawEtag;
            $row->state_token = $this->generateStateToken();
            $row->save();
        }

        return $row;
    }

    private function stateMismatch(): ApiHttpException
    {
        return new ApiHttpException(
            412,
            'Calendar event state does not match ifInState.',
            'stateMismatch',
        );
    }

    private function generateStateToken(): string
    {
        return Str::lower(Str::replace('-', '', Str::uuid()->toString()));
    }
}
