<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;

/**
 * JMAP CalendarEvent/set mapping (RFC 8620 §5.3 response semantics).
 *
 * `created` maps creation id => { id, state } (server-set properties);
 * `updated` maps event id => { state } (the server-changed state token).
 * Top-level oldState/newState use the same per-calendar sync state as
 * /changes, scoped to the calendars touched by this request: a single
 * calendar's plain synctoken, or the `{count}:{uri:token,...}` composite.
 *
 * Deliberate divergence from RFC 8620: ifInState is per record (create-side
 * absent, update/destroy entries carry their own token) instead of a single
 * request-level ifInState, because our item state tokens are per event.
 */
final class CalendarEventSetService
{
    public function __construct(
        private readonly CalendarEventRepository $events,
        private readonly JmapCalendarEventStateService $states,
    ) {}

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function set(string $username, array $payload): array
    {
        $beforeTokens = $this->events->calendarSyncTokens($username);
        $touchedUris = [];

        $created = [];
        $notCreated = [];
        $createMap = $payload['create'] ?? [];
        if (is_array($createMap)) {
            foreach ($createMap as $creationId => $eventPayload) {
                if (! is_string($creationId) || ! is_array($eventPayload)) {
                    continue;
                }
                try {
                    $event = $this->events->create($username, $eventPayload);
                    $created[$creationId] = [
                        'id' => (string) $event['id'],
                        'state' => (string) ($event['state'] ?? ''),
                    ];
                    $this->collectTouchedUris($touchedUris, $event);
                } catch (ApiHttpException $e) {
                    $notCreated[$creationId] = $this->errorShape($e);
                } catch (\Throwable $e) {
                    $notCreated[$creationId] = [
                        'type' => 'serverFail',
                        'description' => $e->getMessage(),
                    ];
                }
            }
        }

        [$updated, $notUpdated] = $this->applyUpdates($username, $payload['update'] ?? [], $touchedUris);
        [$destroyed, $notDestroyed] = $this->applyDestroys($username, $payload['destroy'] ?? null, $touchedUris);

        [$oldState, $newState] = $this->resolveSetStates($username, $beforeTokens, $touchedUris);

        return [
            'oldState' => $oldState,
            'newState' => $newState,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
            'notCreated' => $notCreated,
            'notUpdated' => $notUpdated,
            'notDestroyed' => $notDestroyed,
        ];
    }

    /**
     * oldState/newState compose the touched calendars' sync tokens before/after
     * the mutations; when nothing was mutated the scope falls back to every
     * owned VEVENT calendar (state unchanged, so oldState equals newState).
     *
     * @param  array<string, string>  $beforeTokens
     * @param  array<string, true>  $touchedUris
     * @return array{0: string, 1: string}
     */
    private function resolveSetStates(string $username, array $beforeTokens, array $touchedUris): array
    {
        $afterTokens = $this->events->calendarSyncTokens($username);
        $scope = $touchedUris === [] ? array_keys($afterTokens) : array_keys($touchedUris);

        $before = [];
        $after = [];
        foreach ($scope as $uri) {
            if (isset($beforeTokens[$uri])) {
                $before[$uri] = $beforeTokens[$uri];
            }
            if (isset($afterTokens[$uri])) {
                $after[$uri] = $afterTokens[$uri];
            }
        }

        return [
            CalendarEventRepository::composeCalendarState($before),
            CalendarEventRepository::composeCalendarState($after),
        ];
    }

    /**
     * @param  array<string, true>  $touchedUris
     * @param  array<string, mixed>  $event
     */
    private function collectTouchedUris(array &$touchedUris, array $event): void
    {
        $calendarIds = $event['calendarIds'] ?? [];
        if (! is_array($calendarIds)) {
            return;
        }
        foreach (array_keys($calendarIds) as $uri) {
            $touchedUris[(string) $uri] = true;
        }
    }

    /**
     * @param  array<string, true>  $touchedUris
     * @return array{0: array<string, array{state: string}>, 1: array<string, array<string, mixed>>}
     */
    private function applyUpdates(string $username, mixed $updateMap, array &$touchedUris): array
    {
        $updated = [];
        $notUpdated = [];
        if (! is_array($updateMap)) {
            return [$updated, $notUpdated];
        }

        foreach ($updateMap as $eventId => $updatePayload) {
            if (! is_string($eventId) || ! is_array($updatePayload)) {
                continue;
            }
            try {
                $ifInState = isset($updatePayload['ifInState']) && is_string($updatePayload['ifInState'])
                    ? $updatePayload['ifInState']
                    : null;
                $patch = $updatePayload;
                unset($patch['ifInState']);

                [$ifMatch, $requirePrecondition] = $this->resolveIfInState($username, $eventId, $ifInState);

                $event = $this->events->patchWithPrecondition(
                    $username,
                    $eventId,
                    $patch,
                    $ifMatch,
                    null,
                    $requirePrecondition,
                );
                $updated[$eventId] = ['state' => (string) ($event['state'] ?? '')];
                $this->collectTouchedUris($touchedUris, $event);
            } catch (ApiHttpException $e) {
                $notUpdated[$eventId] = $this->errorShape($e);
            } catch (\Throwable $e) {
                $notUpdated[$eventId] = [
                    'type' => 'serverFail',
                    'description' => $e->getMessage(),
                ];
            }
        }

        return [$updated, $notUpdated];
    }

    /**
     * @param  array<string, true>  $touchedUris
     * @return array{0: list<string>, 1: array<string, array<string, mixed>>}
     */
    private function applyDestroys(string $username, mixed $destroyPayload, array &$touchedUris): array
    {
        $destroyed = [];
        $notDestroyed = [];
        if (! is_array($destroyPayload)) {
            return [$destroyed, $notDestroyed];
        }

        foreach ($this->normalizeDestroyEntries($destroyPayload) as $eventId => $ifInState) {
            try {
                $calendarUri = $this->events->calendarUriForEvent($username, $eventId);
                [$ifMatch, $requirePrecondition] = $this->resolveIfInState($username, $eventId, $ifInState);
                $this->events->deleteWithPrecondition($username, $eventId, $ifMatch, null, $requirePrecondition);
                $destroyed[] = $eventId;
                if ($calendarUri !== null) {
                    $touchedUris[$calendarUri] = true;
                }
            } catch (ApiHttpException $e) {
                $notDestroyed[$eventId] = $this->errorShape($e);
            }
        }

        return [$destroyed, $notDestroyed];
    }

    /**
     * Accepts both destroy shapes: a list of ids, or a map of id to { ifInState }.
     *
     * @param  array<mixed>  $destroyPayload
     * @return array<string, string|null>
     */
    private function normalizeDestroyEntries(array $destroyPayload): array
    {
        $entries = [];
        if ($this->isListArray($destroyPayload)) {
            foreach ($destroyPayload as $eventId) {
                if (is_string($eventId) && $eventId !== '') {
                    $entries[$eventId] = null;
                }
            }

            return $entries;
        }

        foreach ($destroyPayload as $eventId => $destroyEntry) {
            if (! is_string($eventId)) {
                continue;
            }
            $ifInState = null;
            if (is_array($destroyEntry) && isset($destroyEntry['ifInState']) && is_string($destroyEntry['ifInState'])) {
                $ifInState = $destroyEntry['ifInState'];
            }
            $entries[$eventId] = $ifInState;
        }

        return $entries;
    }

    /**
     * @return array{0: string|null, 1: bool}
     */
    private function resolveIfInState(string $username, string $eventId, ?string $ifInState): array
    {
        if ($ifInState === null || $ifInState === '') {
            return [null, false];
        }

        $ifMatch = OptimisticConcurrency::formatEtag(
            $this->states->resolveEtagForIfInState($username, $eventId, $ifInState),
        );

        return [$ifMatch, true];
    }

    /**
     * Maps internal error codes to RFC 8620 §5.3 SetError types.
     *
     * @return array<string, mixed>
     */
    private function errorShape(ApiHttpException $e): array
    {
        $type = match ($e->errorCode()) {
            'not_found' => 'notFound',
            'bad_request' => 'invalidProperties',
            'forbidden' => 'forbidden',
            'stateMismatch', 'precondition_failed' => 'stateMismatch',
            'server_error', 'serverError', null => 'serverFail',
            default => $e->errorCode(),
        };

        $shape = [
            'type' => $type,
            'description' => $e->getMessage(),
        ];
        if ($type === 'invalidProperties') {
            $shape['properties'] = $e->invalidProperties();
        }

        return $shape;
    }

    /**
     * @param  array<mixed>  $array
     */
    private function isListArray(array $array): bool
    {
        if ($array === []) {
            return true;
        }

        return array_keys($array) === range(0, count($array) - 1);
    }
}
