<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\Conversion\CalendarConversionSupport;
use App\Services\Calendars\Conversion\CalendarIcsSplitSupport;
use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Services\VObject\VObjectPayloadGuard;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;

final class CalendarEventRepository
{
    public function __construct(
        private readonly CalendarEventMapper $mapper,
        private readonly SearchIndexerService $searchIndexer,
        private readonly BestEffortSearchIndexSync $searchIndexSync,
        private readonly CalendarEventExpansionService $expansion,
        private readonly JmapCalendarEventStateService $eventStates,
        private readonly CalendarRepository $calendars,
        private readonly CalendarSchedulingService $scheduling,
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
            foreach ($this->mapper->toCalendarEvents($object, $calendarId, $username) as $event) {
                if ($expandRecurrences && $after !== null && $before !== null && $this->expansion->isRecurring($event)) {
                    foreach ($this->expansion->expandInWindow($event, $raw, $calendarId, $after, $before) as $instance) {
                        $events[] = $instance;
                    }
                } else {
                    $events[] = $event;
                }
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
        $instances = $this->resolveQueryCalendars($username, $filter['inCalendars'] ?? null);
        $window = $this->parseQueryWindow($filter);
        $title = isset($filter['title']) && is_string($filter['title']) && trim($filter['title']) !== ''
            ? trim($filter['title'])
            : null;

        $matches = [];
        foreach ($instances as $instance) {
            foreach ($this->candidateObjects($instance, $window) as $object) {
                $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $calendarApiId = $this->calendars->apiIdForInstance($instance);
                foreach ($this->mapper->toCalendarEvents($object, $calendarApiId, $username) as $event) {
                    if ($title !== null && stripos((string) ($event['title'] ?? ''), $title) === false) {
                        continue;
                    }
                    if ($window !== null && ! $this->eventIntersectsWindow($event, $raw, $calendarApiId, $window)) {
                        continue;
                    }
                    $matches[] = $event;
                }
            }
        }

        $this->sortEvents($matches, $sort);

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
        return $this->findOwnedEvent($username, $eventId)['calendarUri'] ?? null;
    }

    /**
     * @return list<CalendarInstance>
     */
    private function resolveQueryCalendars(string $username, mixed $inCalendars): array
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
    private function parseQueryWindow(array $filter): ?array
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
    private function candidateObjects(CalendarInstance $instance, ?array $window): Collection
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
    private function eventIntersectsWindow(array $event, string $raw, string $calendarUri, array $window): bool
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
    private function sortEvents(array &$events, array $sort): void
    {
        $comparators = [];
        foreach ($sort as $spec) {
            $property = is_array($spec) ? (string) ($spec['property'] ?? '') : '';
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

        $changes = $this->calBackend()->getChangesForCalendar(
            $this->calBackendCalendarId($instance),
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
            $object = $this->findObjectInCalendar((int) $instance->calendarid, $uri);
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

        $currentToken = (int) ($instance->calendar?->synctoken ?? 0);
        if (! ctype_digit($since) || (int) $since > $currentToken) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        return $since;
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $eventId): array
    {
        $located = $this->findOwnedEvent($username, $eventId);
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
        $instance = $this->resolveCalendarFromPayload($username, $payload);
        $this->assertAcceptsEventWrites($username, $instance);
        $this->calendars->assertEventWritable($instance);

        return DB::connection('wgw')->transaction(function () use ($username, $payload, $instance): array {
            CalendarInstance::query()->whereKey($instance->getKey())->lockForUpdate()->first();
            $eventPayload = $this->scheduling->withOrganizer($username, $this->normalizeEventPayload($payload));
            $eventUri = $this->allocateEventUri((int) $instance->calendarid, $eventPayload);
            $ics = $this->mapper->toIcs($eventPayload);

            $this->calBackend()->createCalendarObject($this->calBackendCalendarId($instance), $eventUri, $ics);
            $this->scheduling->scheduleAfterWrite($username, null, $ics);
            $davPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
            $this->searchIndexSync->sync(
                'calendars',
                fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                $davPath,
                $username,
            );

            $object = $this->findObjectInCalendar((int) $instance->calendarid, $eventUri, fresh: true);
            if ($object === null) {
                throw new ApiHttpException(500, 'Could not load created calendar event.', 'server_error');
            }

            return $this->mapper->toCalendarEvent($object, $this->calendars->apiIdForInstance($instance), null, $username);
        });
    }

    /**
     * Import VEVENT UID groups from an ICS file. Does not run iTIP/iMIP.
     *
     * @return array{list: list<array<string, mixed>>, errors: list<array{index: int, message: string}>}
     */
    public function importFromIcs(string $username, string $icsText, string $calendarId): array
    {
        $instance = $this->calendars->findAccessibleCalendar($username, $calendarId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        if (! $this->calendars->instanceMayWrite($instance)) {
            throw new ApiHttpException(403, 'Calendar is not writable.', 'forbidden');
        }

        (new VObjectPayloadGuard)->assertIcsSize($icsText);

        try {
            $groups = CalendarIcsSplitSupport::splitUidGroups($icsText);
        } catch (\InvalidArgumentException $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'bad_request');
        }

        if ($groups === []) {
            throw new ApiHttpException(400, 'No VEVENT data found.', 'bad_request');
        }

        $list = [];
        $errors = [];
        foreach ($groups as $index => $group) {
            try {
                foreach ($this->persistImportedUidGroup($username, $instance, $group['ics']) as $event) {
                    $list[] = $event;
                }
            } catch (ApiHttpException $exception) {
                $errors[] = ['index' => $index, 'message' => $exception->getMessage()];
            } catch (\Throwable) {
                $errors[] = ['index' => $index, 'message' => 'Could not import event.'];
            }
        }

        return ['list' => $list, 'errors' => $errors];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function persistImportedUidGroup(string $username, CalendarInstance $instance, string $ics): array
    {
        return DB::connection('wgw')->transaction(function () use ($username, $instance, $ics): array {
            CalendarInstance::query()->whereKey($instance->getKey())->lockForUpdate()->first();
            $this->assertImportableGroupIcs($ics);

            $eventUri = $this->allocateEventUri((int) $instance->calendarid, [
                'title' => $this->importedEventTitle($ics),
            ]);
            $this->calBackend()->createCalendarObject($this->calBackendCalendarId($instance), $eventUri, $ics);

            $davPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
            $this->searchIndexSync->sync(
                'calendars',
                fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                $davPath,
                $username,
            );

            $object = $this->findObjectInCalendar((int) $instance->calendarid, $eventUri, fresh: true);
            if ($object === null) {
                throw new ApiHttpException(500, 'Could not load imported calendar event.', 'server_error');
            }

            return $this->mapper->toCalendarEvents(
                $object,
                $this->calendars->apiIdForInstance($instance),
                $username,
            );
        });
    }

    private function assertImportableGroupIcs(string $ics): void
    {
        $events = (new ICalendarJmapEventConverter)->eventsFromIcs($ics);
        $knownFrequencies = ['secondly', 'minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'];
        foreach ($events as $event) {
            $rules = $event['recurrenceRules'] ?? [];
            if (! is_array($rules)) {
                continue;
            }
            foreach ($rules as $rule) {
                if (! is_array($rule)) {
                    continue;
                }
                $frequency = strtolower((string) ($rule['frequency'] ?? ''));
                if ($frequency !== '' && ! in_array($frequency, $knownFrequencies, true)) {
                    throw new ApiHttpException(400, 'Unparseable recurrence rule.', 'bad_request');
                }
            }
        }
    }

    private function importedEventTitle(string $ics): string
    {
        if (preg_match('/^SUMMARY:(.*)$/mi', $ics, $matches) === 1) {
            $title = trim(str_replace('\\,', ',', $matches[1]));
            if ($title !== '') {
                return $title;
            }
        }

        return 'event';
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
        return $this->persistEventMutation($username, $eventId, $payload, false, $ifMatch, $ifUnmodifiedSince);
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
        return $this->persistEventMutation($username, $eventId, $patch, true, $ifMatch, $ifUnmodifiedSince);
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
        return $this->persistEventMutation(
            $username,
            $eventId,
            $patch,
            true,
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
        return $this->deleteWithPrecondition($username, $eventId, $ifMatch, $ifUnmodifiedSince, true);
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
        return DB::connection('wgw')->transaction(function () use ($username, $eventId, $ifMatch, $ifUnmodifiedSince, $requirePrecondition): array {
            $located = $this->findOwnedEvent($username, $eventId, lock: true);
            if ($located === null) {
                throw new ApiHttpException(404, 'Calendar event not found.', 'not_found');
            }

            $this->assertObjectPreconditions($located['object'], $ifMatch, $ifUnmodifiedSince, $requirePrecondition);
            $this->assertAcceptsEventWrites($username, $located['instance']);

            return $this->finishDelete($username, $located);
        });
    }

    /**
     * @param  array{object: CalendarObject, instance: CalendarInstance, calendarUri: string, veventUid: string|null}  $located
     * @return array{ok: true}
     */
    private function finishDelete(string $username, array $located): array
    {
        $instance = $located['instance'];
        $this->calendars->assertEventWritable($instance);
        $object = $located['object'];
        $eventUri = (string) $object->uri;
        $veventUid = $located['veventUid'];
        $oldIcs = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;

        if ($veventUid !== null) {
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            $remaining = $this->mapper->removeVEventFromIcs($raw, $veventUid);
            if ($remaining === null) {
                $this->calBackend()->deleteCalendarObject($this->calBackendCalendarId($instance), $eventUri);
                $this->scheduling->scheduleAfterDelete($username, $oldIcs);
                $davPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
                $this->searchIndexSync->sync(
                    'calendars',
                    fn () => $this->searchIndexer->deleteDavPath($davPath),
                    $davPath,
                    $username,
                );
            } else {
                $this->calBackend()->updateCalendarObject($this->calBackendCalendarId($instance), $eventUri, $remaining);
                $this->scheduling->scheduleAfterWrite($username, $oldIcs, $remaining);
                $davPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
                $this->searchIndexSync->sync(
                    'calendars',
                    fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                    $davPath,
                    $username,
                );
            }
        } else {
            $this->calBackend()->deleteCalendarObject($this->calBackendCalendarId($instance), $eventUri);
            $this->scheduling->scheduleAfterDelete($username, $oldIcs);
            $davPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
            $this->searchIndexSync->sync(
                'calendars',
                fn () => $this->searchIndexer->deleteDavPath($davPath),
                $davPath,
                $username,
            );
        }

        return ['ok' => true];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function persistEventMutation(
        string $username,
        string $eventId,
        array $payload,
        bool $deepMerge,
        ?string $ifMatch = null,
        ?string $ifUnmodifiedSince = null,
        bool $requirePrecondition = true,
    ): array {
        return DB::connection('wgw')->transaction(function () use (
            $username,
            $eventId,
            $payload,
            $deepMerge,
            $ifMatch,
            $ifUnmodifiedSince,
            $requirePrecondition,
        ): array {
            $located = $this->findOwnedEvent($username, $eventId, lock: true);
            if ($located === null) {
                throw new ApiHttpException(404, 'Calendar event not found.', 'not_found');
            }

            $this->assertObjectPreconditions($located['object'], $ifMatch, $ifUnmodifiedSince, $requirePrecondition);

            $instance = $located['instance'];
            $this->assertAcceptsEventWrites($username, $instance);
            $this->calendars->assertEventWritable($instance);
            $object = $located['object'];
            $eventUri = (string) $object->uri;
            $existingEvent = $this->mapper->toCalendarEvent(
                $object,
                $this->calendars->apiIdForInstance($instance),
                $located['veventUid'],
                $username,
            );
            $eventPayload = $this->scheduling->withOrganizer(
                $username,
                $deepMerge
                    ? $this->normalizeEventPayload(
                        CalendarConversionSupport::deepMergeEventPatch($existingEvent, $payload),
                        $existingEvent,
                    )
                    : $this->normalizeEventPayload($payload, $existingEvent),
            );

            $eventPayload['id'] = $existingEvent['id'] ?? $eventId;
            if ($located['veventUid'] !== null) {
                $eventPayload['uid'] = $located['veventUid'];
            } else {
                $eventPayload['uid'] = $existingEvent['uid'] ?? $eventPayload['uid'] ?? null;
            }
            $targetInstance = $this->resolvePatchTargetCalendar($username, $payload, $instance);
            $this->calendars->assertEventWritable($targetInstance);
            $eventPayload['calendarIds'] = [$this->calendars->apiIdForInstance($targetInstance) => true];

            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            $ics = $this->scheduling->persistableIcs(
                $username,
                $raw,
                $this->mapper->updateIcs($raw, $eventPayload, $located['veventUid']),
            );
            $sourceBackendId = $this->calBackendCalendarId($instance);
            $targetBackendId = $this->calBackendCalendarId($targetInstance);
            if ($sourceBackendId !== $targetBackendId) {
                $this->calBackend()->createCalendarObject($targetBackendId, $eventUri, $ics);
                $this->calBackend()->deleteCalendarObject($sourceBackendId, $eventUri);
                $oldPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
                $this->searchIndexSync->sync(
                    'calendars',
                    fn () => $this->searchIndexer->deleteDavPath($oldPath),
                    $oldPath,
                    $username,
                );
            } else {
                $this->calBackend()->updateCalendarObject($targetBackendId, $eventUri, $ics);
            }
            $this->scheduling->scheduleAfterWrite($username, $raw, $ics);
            $davPath = $this->calDavPath($username, (string) $targetInstance->uri, $eventUri);
            $this->searchIndexSync->sync(
                'calendars',
                fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                $davPath,
                $username,
            );

            $updated = $this->findObjectInCalendar((int) $targetInstance->calendarid, $eventUri, fresh: true);
            if ($updated === null) {
                throw new ApiHttpException(500, 'Could not load updated calendar event.', 'server_error');
            }

            return $this->mapper->toCalendarEvent(
                $updated,
                $this->calendars->apiIdForInstance($targetInstance),
                $located['veventUid'],
                $username,
            );
        });
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function resolvePatchTargetCalendar(
        string $username,
        array $payload,
        CalendarInstance $current,
    ): CalendarInstance {
        $calendarIds = $payload['calendarIds'] ?? null;
        if (! is_array($calendarIds) || $calendarIds === []) {
            return $current;
        }

        $requestedId = null;
        foreach ($calendarIds as $id => $enabled) {
            if ($enabled === true) {
                $requestedId = (string) $id;
                break;
            }
        }
        if ($requestedId === null || $requestedId === '' || $requestedId === $this->calendars->apiIdForInstance($current)) {
            return $current;
        }

        $target = $this->calendars->findAccessibleCalendar($username, $requestedId);
        if ($target === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }
        $this->assertAcceptsEventWrites($username, $target);

        return $target;
    }

    private function assertAcceptsEventWrites(string $username, CalendarInstance $instance): void
    {
        if ($this->calendars->isSubscriptionCalendar($username, $this->calendars->apiIdForInstance($instance))) {
            throw new ApiHttpException(403, 'Subscription calendars are read-only.', 'forbidden');
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function resolveCalendarFromPayload(string $username, array $payload): CalendarInstance
    {
        $calendarIds = $payload['calendarIds'] ?? null;
        if (! is_array($calendarIds) || $calendarIds === []) {
            throw new ApiHttpException(400, 'calendarIds is required.', 'bad_request', ['calendarIds']);
        }

        $calendarUri = null;
        foreach ($calendarIds as $id => $enabled) {
            if ($enabled === true) {
                $calendarUri = (string) $id;
                break;
            }
        }

        if ($calendarUri === null || $calendarUri === '') {
            throw new ApiHttpException(400, 'calendarIds is required.', 'bad_request', ['calendarIds']);
        }

        $instance = $this->calendars->findAccessibleCalendar($username, $calendarUri);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Calendar not found.', 'not_found');
        }

        return $instance;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>|null  $existingEvent
     * @return array<string, mixed>
     */
    private function normalizeEventPayload(array $payload, ?array $existingEvent = null): array
    {
        $event = $payload;
        unset($event['id'], $event['x-wgw-icsMultiEvent']);

        if (! isset($event['start']) || ! is_string($event['start']) || trim($event['start']) === '') {
            if ($existingEvent !== null && isset($existingEvent['start']) && is_string($existingEvent['start'])) {
                $event['start'] = $existingEvent['start'];
            } else {
                throw new ApiHttpException(400, 'start is required.', 'bad_request', ['start']);
            }
        }

        return CalendarConversionSupport::normalizeEventMapKeys($event, $existingEvent);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function allocateEventUri(int $calendarId, array $payload): string
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = CalendarEventMapper::generateEventUri($payload);
            if ($this->findObjectInCalendar($calendarId, $candidate) === null) {
                return $candidate;
            }
        }

        throw new ApiHttpException(500, 'Could not allocate calendar event id.', 'server_error');
    }

    /**
     * @return array{object: CalendarObject, instance: CalendarInstance, calendarUri: string, veventUid: string|null}|null
     */
    private function findOwnedEvent(string $username, string $eventId, bool $lock = false): ?array
    {
        $parsed = CalendarConversionSupport::parseEventId($eventId);
        $eventUri = CalendarEventMapper::eventUriFromId($eventId);
        $principalUris = $this->calendars->accessiblePrincipalUris($username);
        $query = CalendarObject::query()
            ->where('uri', $eventUri)
            ->whereHas('calendar.instances', function ($query) use ($principalUris): void {
                $query->whereIn('principaluri', $principalUris);
            });
        if ($lock) {
            $query->lockForUpdate();
        }
        $object = $query->first();

        if ($object === null) {
            return null;
        }

        $instance = CalendarInstance::query()
            ->where('calendarid', (int) $object->calendarid)
            ->whereIn('principaluri', $principalUris)
            ->first();

        if ($instance === null) {
            return null;
        }

        $calendarApiId = $this->calendars->apiIdForInstance($instance);
        $veventUid = $parsed['veventUid'];
        if ($veventUid === null) {
            $events = $this->mapper->toCalendarEvents($object, $calendarApiId);
            if (count($events) > 1) {
                return null;
            }
        } else {
            $found = false;
            foreach ($this->mapper->toCalendarEvents($object, $calendarApiId) as $event) {
                if (($event['uid'] ?? '') === $veventUid) {
                    $found = true;
                    break;
                }
            }
            if (! $found) {
                return null;
            }
        }

        return [
            'object' => $object,
            'instance' => $instance,
            'calendarUri' => $calendarApiId,
            'veventUid' => $veventUid,
        ];
    }

    private function findObjectInCalendar(int $calendarId, string $eventUri, bool $fresh = false): ?CalendarObject
    {
        $object = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uri', $eventUri)
            ->first();

        if ($object !== null && $fresh) {
            $object->refresh();
        }

        return $object;
    }

    private function calDavPath(string $username, string $calendarUri, string $eventUri): string
    {
        return 'calendars/'.$username.'/'.$calendarUri.'/'.$eventUri;
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private function assertObjectPreconditions(
        CalendarObject $object,
        ?string $ifMatch,
        ?string $ifUnmodifiedSince,
        bool $requirePrecondition = true,
    ): void {
        OptimisticConcurrency::assertPreconditions(
            $ifMatch,
            $ifUnmodifiedSince,
            is_string($object->etag) ? $object->etag : null,
            (int) ($object->lastmodified ?? 0),
            $requirePrecondition,
        );
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function calBackendCalendarId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }
}
