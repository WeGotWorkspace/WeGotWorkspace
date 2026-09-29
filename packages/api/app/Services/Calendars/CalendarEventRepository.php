<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\VObject\VObjectPayloadGuard;

final class CalendarEventRepository
{
    public function __construct(
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarEventExpansionService $expansion,
        private readonly CalendarRepository $calendars,
        private readonly CalendarEventQuerySupport $queries,
        private readonly CalendarEventMutationSupport $mutations,
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(
        string $username,
        string $calendarId,
        ?string $after = null,
        ?string $before = null,
        bool $expandRecurrences = false,
    ): array {
        $instance = $this->calendars->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VEVENT')
            ->orderBy('uri')
            ->get();

        $events = [];
        foreach ($objects as $object) {
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            try {
                foreach ($this->mapper->toCalendarEvents($object, $calendarId, $username) as $event) {
                    if ($expandRecurrences && $after !== null && $before !== null && $this->expansion->isRecurring($event)) {
                        foreach ($this->expansion->expandInWindow($event, $raw, $calendarId, $after, $before) as $instance) {
                            $events[] = $instance;
                        }
                    } else {
                        $events[] = $event;
                    }
                }
            } catch (ApiHttpException $e) {
                if (VObjectPayloadGuard::isPayloadBoundError($e)) {
                    continue;
                }
                throw $e;
            }
        }

        return ['list' => $events];
    }

    /**
     * JMAP CalendarEvent/query mapping: filter by calendar ids, time range, and title.
     *
     * Sabre's object-level firstoccurence/lastoccurence columns act as an
     * index-assisted SQL pre-filter; the exact match is refined in PHP per
     * VEVENT (composite ids match on their own occurrences, with recurrence
     * expansion via CalendarEventExpansionService).
     *
     * @param  array<string, mixed>  $filter
     * @param  list<array<string, mixed>>  $sort
     * @return array{ids: list<string>, position: int, total: int, queryState: string, canCalculateChanges: bool}
     */
    public function query(
        string $username,
        array $filter,
        array $sort = [],
        int $position = 0,
        ?int $limit = null,
    ): array {
        $instances = $this->queries->resolveQueryCalendars($username, $filter['inCalendars'] ?? null);
        $window = $this->queries->parseQueryWindow($filter);
        $title = isset($filter['title']) && is_string($filter['title']) && trim($filter['title']) !== ''
            ? trim($filter['title'])
            : null;

        $matches = [];
        foreach ($instances as $instance) {
            foreach ($this->queries->candidateObjects($instance, $window) as $object) {
                $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $calendarApiId = $this->calendars->apiIdForInstance($instance);
                try {
                    foreach ($this->mapper->toCalendarEvents($object, $calendarApiId, $username) as $event) {
                        if ($title !== null && stripos((string) ($event['title'] ?? ''), $title) === false) {
                            continue;
                        }
                        if ($window !== null && ! $this->queries->eventIntersectsWindow($event, $raw, $calendarApiId, $window)) {
                            continue;
                        }
                        $matches[] = $event;
                    }
                } catch (ApiHttpException $e) {
                    if (VObjectPayloadGuard::isPayloadBoundError($e)) {
                        continue;
                    }
                    throw $e;
                }
            }
        }

        $this->queries->sortEvents($matches, $sort);

        $ids = [];
        foreach ($matches as $event) {
            $id = (string) ($event['id'] ?? '');
            if ($id !== '') {
                $ids[] = $id;
            }
        }

        $queryTokens = [];
        foreach ($instances as $instance) {
            $queryTokens[$this->calendars->apiIdForInstance($instance)] = (string) (int) ($instance->calendar?->synctoken ?? 1);
        }

        return [
            'ids' => array_slice($ids, $position, $limit),
            'position' => $position,
            'total' => count($ids),
            // Same state string /changes uses, composed across the queried calendars (RFC 8620 §5.5).
            'queryState' => self::composeCalendarState($queryTokens),
            // CalendarEvent/queryChanges is not implemented.
            'canCalculateChanges' => false,
        ];
    }

    /**
     * Composes a /changes-comparable state string over per-calendar sync tokens:
     * a single calendar's plain synctoken, or the `{count}:{uri:token,...}` composite
     * (same format as the collection-level state) sorted by calendar uri.
     *
     * @param  array<string, string>  $tokensByUri
     */
    public static function composeCalendarState(array $tokensByUri): string
    {
        if (count($tokensByUri) === 1) {
            return (string) reset($tokensByUri);
        }

        ksort($tokensByUri);
        $parts = [];
        foreach ($tokensByUri as $uri => $token) {
            $parts[] = $uri.':'.$token;
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    /**
     * Current per-calendar sync tokens for every owned VEVENT calendar.
     *
     * @return array<string, string> calendar uri => synctoken
     */
    public function calendarSyncTokens(string $username): array
    {
        $tokens = [];
        $instances = $this->calendars->accessibleVeventInstances($username);
        foreach ($instances as $instance) {
            $tokens[$this->calendars->apiIdForInstance($instance)] = (string) (int) ($instance->calendar?->synctoken ?? 1);
        }

        return $tokens;
    }

    /**
     * Calendar uri owning the given event id, or null when not visible to the user.
     */
    public function calendarUriForEvent(string $username, string $eventId): ?string
    {
        return $this->mutations->findOwnedEvent($username, $eventId)['calendarUri'] ?? null;
    }

    /**
     * @return list<CalendarInstance>
     */
    public function show(string $username, string $eventId): array
    {
        $located = $this->mutations->findOwnedEvent($username, $eventId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Calendar event not found.', 'not_found');
        }

        return $this->mapper->toCalendarEvent(
            $located['object'],
            $located['calendarUri'],
            $located['veventUid'],
            $username,
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        return $this->mutations->create($username, $payload);
    }

    /**
     * Import VEVENT UID groups from an ICS file. Does not run iTIP/iMIP.
     *
     * @return array{list: list<array<string, mixed>>, errors: list<array{index: int, message: string, code?: string}>}
     */
    public function importFromIcs(string $username, string $icsText, string $calendarId): array
    {
        return $this->mutations->importFromIcs($username, $icsText, $calendarId);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(
        string $username,
        string $eventId,
        array $payload,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        return $this->mutations->update($username, $eventId, $payload, $ifMatch, $ifUnmodifiedSince);
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public function patch(
        string $username,
        string $eventId,
        array $patch,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        return $this->mutations->patch($username, $eventId, $patch, $ifMatch, $ifUnmodifiedSince);
    }

    /**
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public function patchWithPrecondition(
        string $username,
        string $eventId,
        array $patch,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        return $this->mutations->patchWithPrecondition(
            $username,
            $eventId,
            $patch,
            $ifMatch,
            $ifUnmodifiedSince,
            $requirePrecondition,
        );
    }

    /**
     * @return array{ok: true}
     */
    public function delete(
        string $username,
        string $eventId,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
    ): array {
        return $this->mutations->delete($username, $eventId, $ifMatch, $ifUnmodifiedSince);
    }

    /**
     * @return array{ok: true}
     */
    public function deleteWithPrecondition(
        string $username,
        string $eventId,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        return $this->mutations->deleteWithPrecondition(
            $username,
            $eventId,
            $ifMatch,
            $ifUnmodifiedSince,
            $requirePrecondition,
        );
    }

    /**
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
        return $this->queries->changes($username, $calendarId, $since);
    }
}
