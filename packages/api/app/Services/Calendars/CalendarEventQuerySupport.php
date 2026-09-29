<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Eloquent\Collection;

final class CalendarEventQuerySupport
{
    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarEventExpansionService $expansion,
        private readonly JmapCalendarEventStateService $eventStates,
        private readonly CalendarEventMutationSupport $mutations,
    ) {}

    public function resolveQueryCalendars(string $username, mixed $inCalendars): array
    {
        if (! is_array($inCalendars) || $inCalendars === []) {
            throw new ApiHttpException(400, 'filter.inCalendars is required.', 'bad_request');
        }

        $instances = [];
        foreach ($inCalendars as $calendarId) {
            if (! is_string($calendarId) || trim($calendarId) === '') {
                throw new ApiHttpException(400, 'filter.inCalendars must contain calendar ids.', 'bad_request');
            }
            $instance = $this->calendars->findAccessibleCalendar($username, $calendarId);
            if ($instance === null) {
                throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
            }
            $instances[] = $instance;
        }

        return $instances;
    }

    /**
     * @param  array<string, mixed>  $filter
     * @return array{after: DateTimeImmutable, before: DateTimeImmutable, afterRaw: string, beforeRaw: string}|null
     */
    public function parseQueryWindow(array $filter): ?array
    {
        $after = isset($filter['after']) && is_string($filter['after']) && trim($filter['after']) !== ''
            ? trim($filter['after'])
            : null;
        $before = isset($filter['before']) && is_string($filter['before']) && trim($filter['before']) !== ''
            ? trim($filter['before'])
            : null;

        if ($after === null && $before === null) {
            return null;
        }
        if ($after === null || $before === null) {
            throw new ApiHttpException(400, 'filter.after and filter.before must be provided together.', 'bad_request');
        }

        try {
            $utc = new DateTimeZone('UTC');

            return [
                'after' => new DateTimeImmutable($after, $utc),
                'before' => new DateTimeImmutable($before, $utc),
                'afterRaw' => $after,
                'beforeRaw' => $before,
            ];
        } catch (\Exception) {
            throw new ApiHttpException(400, 'filter.after and filter.before must be valid date-times.', 'bad_request');
        }
    }

    /**
     * @param  array{after: DateTimeImmutable, before: DateTimeImmutable}|null  $window
     * @return Collection<int, CalendarObject>
     */
    public function candidateObjects(CalendarInstance $instance, ?array $window): Collection
    {
        $query = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VEVENT')
            ->orderBy('uri');

        if ($window !== null) {
            $afterTs = $window['after']->getTimestamp();
            $beforeTs = $window['before']->getTimestamp();
            $query
                ->where(function ($q) use ($beforeTs): void {
                    $q->whereNull('firstoccurence')->orWhere('firstoccurence', '<', $beforeTs);
                })
                ->where(function ($q) use ($afterTs): void {
                    $q->whereNull('lastoccurence')->orWhere('lastoccurence', '>', $afterTs);
                });
        }

        return $query->get();
    }

    /**
     * @param  array<string, mixed>  $event
     * @param  array{after: DateTimeImmutable, before: DateTimeImmutable, afterRaw: string, beforeRaw: string}  $window
     */
    public function eventIntersectsWindow(array $event, string $raw, string $calendarUri, array $window): bool
    {
        if ($this->expansion->isRecurring($event)) {
            return $this->expansion->expandInWindow($event, $raw, $calendarUri, $window['afterRaw'], $window['beforeRaw']) !== [];
        }

        $start = $this->parseEventDate($event['start'] ?? null, $event);
        if ($start === null) {
            return false;
        }

        return $start < $window['before'] && $this->resolveEventEnd($event, $start) > $window['after'];
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function resolveEventEnd(array $event, DateTimeImmutable $start): DateTimeImmutable
    {
        $end = $this->parseEventDate($event['end'] ?? null, $event);
        if ($end !== null) {
            return $end;
        }

        $duration = $event['duration'] ?? null;
        if (is_string($duration) && $duration !== '') {
            try {
                return $start->add(new DateInterval($duration));
            } catch (\Exception) {
                // Malformed duration: treat as zero-length below.
            }
        }

        return $start;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function parseEventDate(mixed $value, array $event): ?DateTimeImmutable
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            return new DateTimeImmutable($value, $this->eventTimeZone($event));
        } catch (\Exception) {
            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function eventTimeZone(array $event): DateTimeZone
    {
        $tzid = isset($event['timeZone']) && is_string($event['timeZone']) ? trim($event['timeZone']) : '';
        if ($tzid !== '') {
            try {
                return new DateTimeZone($tzid);
            } catch (\Exception) {
                // Unknown TZID: fall back to UTC.
            }
        }

        return new DateTimeZone('UTC');
    }

    /**
     * @param  list<array<string, mixed>>  $events
     * @param  list<array<string, mixed>>  $sort
     */
    public function sortEvents(array &$events, array $sort): void
    {
        $comparators = [];
        foreach ($sort as $spec) {
            $property = (string) ($spec['property'] ?? '');
            if (! in_array($property, ['start', 'title', 'uid'], true)) {
                continue;
            }
            $comparators[] = [$property, (bool) ($spec['isAscending'] ?? true)];
        }
        if ($comparators === []) {
            $comparators = [['start', true]];
        }

        usort($events, function (array $a, array $b) use ($comparators): int {
            foreach ($comparators as [$property, $ascending]) {
                $result = $this->compareEventsBy($property, $a, $b);
                if ($result !== 0) {
                    return $ascending ? $result : -$result;
                }
            }

            return strcmp((string) ($a['id'] ?? ''), (string) ($b['id'] ?? ''));
        });
    }

    /**
     * @param  array<string, mixed>  $a
     * @param  array<string, mixed>  $b
     */
    private function compareEventsBy(string $property, array $a, array $b): int
    {
        if ($property === 'start') {
            $aStart = $this->parseEventDate($a['start'] ?? null, $a);
            $bStart = $this->parseEventDate($b['start'] ?? null, $b);

            return ($aStart?->getTimestamp() ?? 0) <=> ($bStart?->getTimestamp() ?? 0);
        }

        return strcasecmp((string) ($a[$property] ?? ''), (string) ($b[$property] ?? ''));
    }

    /**
     * Item-level sync over the CalDAV calendarchanges log (JMAP CalendarEvent/changes mapping).
     *
     * Always returns the full delta: Sabre's limit-based truncation dedupes changes
     * per uri keeping the latest synctoken at the uri's first position, so a truncated
     * response could return an intermediate token that skips lower-token changes to
     * other objects. `maxChanges` is therefore accepted but not used for truncation
     * and `hasMoreChanges` is always false (correctness over pagination).
     *
     * @return array{
     *     oldState: string,
     *     newState: string,
     *     hasMoreChanges: bool,
     *     created: list<string>,
     *     updated: list<string>,
     *     destroyed: list<string>
     * }
     */
    public function changes(string $username, string $calendarId, ?string $since): array
    {
        $instance = $this->calendars->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        $changes = $this->mutations->calBackend()->getChangesForCalendar(
            $this->mutations->calBackendCalendarId($instance),
            $this->normalizeSyncToken($instance, $since),
            1,
        );
        if ($changes === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $createdByUri = $this->currentEventIdsByUri($username, $instance, $changes['added'] ?? []);
        $updatedByUri = $this->currentEventIdsByUri($username, $instance, $changes['modified'] ?? []);

        return [
            // Same initial-sync forms normalizeSyncToken accepts (null/''/'0') all report "0".
            'oldState' => ($since === null || $since === '') ? '0' : $since,
            'newState' => (string) $changes['syncToken'],
            'hasMoreChanges' => false,
            'created' => $this->flattenIds($createdByUri),
            'updated' => $this->flattenIds($updatedByUri),
            'destroyed' => $this->destroyedEventIds($username, $changes['deleted'] ?? [], $updatedByUri),
        ];
    }

    /**
     * Sabre reports object uris; a REST client holds the ids list/show emit, so
     * re-read each object and emit those ids (composite ids for multi-VEVENT objects).
     *
     * @param  list<string>  $uris
     * @return array<string, list<string>>
     */
    private function currentEventIdsByUri(string $username, CalendarInstance $instance, array $uris): array
    {
        $idsByUri = [];
        foreach ($uris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                // Sabre logs calendar property changes (updateCalendar) as a
                // change entry with an empty object uri — not an event.
                continue;
            }
            $object = $this->mutations->findObjectInCalendar((int) $instance->calendarid, $uri);
            if ($object === null) {
                $idsByUri[$uri] = [CalendarEventMapper::eventIdFromUri($uri)];

                continue;
            }
            if ((string) $object->componenttype !== 'VEVENT') {
                continue;
            }

            $ids = [];
            foreach ($this->mapper->toCalendarEvents($object, $this->calendars->apiIdForInstance($instance), $username) as $event) {
                $id = (string) ($event['id'] ?? '');
                if ($id !== '') {
                    $ids[] = $id;
                }
            }
            $idsByUri[$uri] = $ids;
        }

        return $idsByUri;
    }

    /**
     * Destroyed = plain objectId plus every id previously surfaced over REST
     * (recorded state rows), so clients holding composite ids see them destroyed.
     * Modified objects additionally destroy ids that no longer resolve
     * (removed sub-VEVENTs, single/multi VEVENT transitions).
     *
     * @param  list<string>  $deletedUris
     * @param  array<string, list<string>>  $updatedByUri
     * @return list<string>
     */
    private function destroyedEventIds(string $username, array $deletedUris, array $updatedByUri): array
    {
        $destroyed = [];
        foreach ($deletedUris as $uri) {
            $uri = (string) $uri;
            if ($uri === '') {
                continue;
            }
            $destroyed[] = CalendarEventMapper::eventIdFromUri($uri);
            foreach ($this->recordedEventIdsForObject($username, $uri) as $recorded) {
                $destroyed[] = $recorded;
            }
        }

        foreach ($updatedByUri as $uri => $currentIds) {
            foreach (array_diff($this->recordedEventIdsForObject($username, (string) $uri), $currentIds) as $removed) {
                $destroyed[] = $removed;
            }
        }

        return array_values(array_unique($destroyed));
    }

    /**
     * Event ids previously emitted over REST for this object uri (state rows;
     * pure-CalDAV objects have none and fall back to the plain objectId).
     *
     * @return list<string>
     */
    private function recordedEventIdsForObject(string $username, string $objectUri): array
    {
        return $this->eventStates->recordedEventIdsForObject($username, $objectUri);
    }

    /**
     * @param  array<string, list<string>>  $idsByUri
     * @return list<string>
     */
    private function flattenIds(array $idsByUri): array
    {
        $ids = [];
        foreach ($idsByUri as $uriIds) {
            foreach ($uriIds as $id) {
                $ids[] = $id;
            }
        }

        return array_values(array_unique($ids));
    }

    /**
     * Empty/zero tokens mean initial sync; anything else must be a numeric token
     * no newer than the calendar's current synctoken (Sabre never returns null
     * for a bogus non-empty token, so validate here).
     */
    private function normalizeSyncToken(CalendarInstance $instance, ?string $since): ?string
    {
        if ($since === null || $since === '' || $since === '0') {
            return null;
        }

        $currentToken = (int) ($instance->calendar->synctoken ?? 0);
        if (! ctype_digit($since) || (int) $since > $currentToken) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return $since;
    }

    /**
     * @return array<string, mixed>
     */
}
