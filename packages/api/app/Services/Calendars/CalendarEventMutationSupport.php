<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Events\EventDispatch;
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
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Sabre\CalDAV\Backend\PDO as CalPDO;

final class CalendarEventMutationSupport
{
    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarEventMapper $mapper,
        private readonly CalendarSchedulingService $scheduling,
        private readonly CalendarMeetLinkWriteHook $meetLinkHook,
        private readonly SearchIndexerService $searchIndexer,
        private readonly BestEffortSearchIndexSync $searchIndexSync,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

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
            $this->meetLinkHook->afterPersist(
                $ics,
                null,
                CalendarMeetOwnerPrincipal::fromInstance($instance),
                CalendarMeetOwnerPrincipal::actorMarker($username),
            );
            $this->scheduling->scheduleAfterWrite($username, null, $ics);
            $davPath = $this->calDavPath($username, (string) $instance->uri, $eventUri);
            $this->searchIndexSync->sync(
                'calendars',
                fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                $davPath,
                $username,
            );
            $this->eventDispatch->fireMutation($username, 'calendars', 'created', $davPath);

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
     * @return array{list: list<array<string, mixed>>, errors: list<array{index: int, message: string, code?: string}>}
     */
    public function importFromIcs(string $username, string $icsText, string $calendarId): array
    {
        Log::withContext(['principal' => $username]);

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
        $guard = new VObjectPayloadGuard;
        foreach ($groups as $index => $group) {
            try {
                $guard->readICalendar($group['ics']);
                foreach ($this->persistImportedUidGroup($username, $instance, $group['ics']) as $event) {
                    $list[] = $event;
                }
            } catch (ApiHttpException $exception) {
                $entry = ['index' => $index, 'message' => $exception->getMessage()];
                if (is_string($exception->errorCode()) && $exception->errorCode() !== '') {
                    $entry['code'] = $exception->errorCode();
                }
                $errors[] = $entry;
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
            $this->meetLinkHook->afterPersist(
                $ics,
                $raw,
                CalendarMeetOwnerPrincipal::fromInstance($targetInstance),
                CalendarMeetOwnerPrincipal::actorMarker($username),
            );
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

        $this->assertEventTitle($event, $existingEvent === null);

        return CalendarConversionSupport::normalizeEventMapKeys($event, $existingEvent);
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function assertEventTitle(array &$event, bool $requireTitle): void
    {
        if (! array_key_exists('title', $event)) {
            if ($requireTitle) {
                throw new ApiHttpException(400, 'title is required.', 'bad_request', ['title']);
            }

            return;
        }

        if (! is_string($event['title']) || trim($event['title']) === '') {
            throw new ApiHttpException(400, 'title is required.', 'bad_request', ['title']);
        }

        $event['title'] = trim($event['title']);
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
    public function findOwnedEvent(string $username, string $eventId, bool $lock = false): ?array
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

    public function findObjectInCalendar(int $calendarId, string $eventUri, bool $fresh = false): ?CalendarObject
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

    public function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }

    /**
     * @return array{0: int, 1: int}
     */
    public function calBackendCalendarId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }
}
