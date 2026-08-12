<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\CalendarEventPatchRequest;
use App\Http\Requests\Api\V1\CalendarEventSetRequest;
use App\Http\Requests\Api\V1\CalendarEventUpsertRequest;
use App\Http\Support\JmapResourceResponse;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarEventSetService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CalendarEventsController
{
    public function __construct(
        private readonly CalendarEventRepository $events,
        private readonly CalendarEventSetService $eventSet,
    ) {}

    public function index(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $calendarId = $request->query('calendarId');
        if (! is_string($calendarId) || trim($calendarId) === '') {
            throw new ApiHttpException(400, 'calendarId is required.', 'bad_request');
        }

        $expandRecurrences = filter_var($request->query('expandRecurrences'), FILTER_VALIDATE_BOOLEAN);
        $after = $request->query('after');
        $before = $request->query('before');
        if ($expandRecurrences && (! is_string($after) || trim($after) === '' || ! is_string($before) || trim($before) === '')) {
            throw new ApiHttpException(400, 'after and before are required when expandRecurrences is true.', 'bad_request');
        }

        return response()->json($this->events->list(
            $principal['username'],
            $calendarId,
            is_string($after) ? $after : null,
            is_string($before) ? $before : null,
            $expandRecurrences,
        ));
    }

    public function set(CalendarEventSetRequest $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json(
            $this->eventSet->set($principal['username'], $request->json()->all()),
        );
    }

    public function changes(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $calendarId = $request->query('calendarId');
        if (! is_string($calendarId) || trim($calendarId) === '') {
            throw new ApiHttpException(400, 'calendarId is required.', 'bad_request');
        }

        $since = $request->query('since');

        // Accepted per RFC 8620 §5.2 but not used for truncation: the backing
        // Sabre changes log cannot produce a safe intermediate sync token, so
        // the full delta is always returned (hasMoreChanges is always false).
        $maxChanges = $request->query('maxChanges');
        if ($maxChanges !== null && (! is_string($maxChanges) || ! ctype_digit($maxChanges) || (int) $maxChanges < 1)) {
            throw new ApiHttpException(400, 'maxChanges must be a positive integer.', 'bad_request');
        }

        return response()->json(
            $this->events->changes($principal['username'], $calendarId, is_string($since) ? $since : null),
        );
    }

    public function show(Request $request, string $eventId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json($this->events->show($principal['username'], $eventId));
    }

    public function store(CalendarEventUpsertRequest $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->events->create($principal['username'], $request->json()->all()),
            201,
        );
    }

    public function update(CalendarEventUpsertRequest $request, string $eventId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->events->update(
                $principal['username'],
                $eventId,
                $request->json()->all(),
                $this->ifMatch($request),
                $this->ifUnmodifiedSince($request),
            )
        );
    }

    public function patch(CalendarEventPatchRequest $request, string $eventId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return JmapResourceResponse::json(
            $this->events->patch(
                $principal['username'],
                $eventId,
                $request->json()->all(),
                $this->ifMatch($request),
                $this->ifUnmodifiedSince($request),
            )
        );
    }

    public function destroy(Request $request, string $eventId): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json(
            $this->events->delete(
                $principal['username'],
                $eventId,
                $this->ifMatch($request),
                $this->ifUnmodifiedSince($request),
            )
        );
    }

    private function ifMatch(Request $request): ?string
    {
        $value = $request->header('If-Match');

        return is_string($value) && $value !== '' ? $value : null;
    }

    private function ifUnmodifiedSince(Request $request): ?string
    {
        $value = $request->header('If-Unmodified-Since');

        return is_string($value) && $value !== '' ? $value : null;
    }
}
