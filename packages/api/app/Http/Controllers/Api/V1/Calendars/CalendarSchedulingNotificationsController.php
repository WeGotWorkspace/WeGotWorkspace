<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Requests\Api\V1\CalendarSchedulingNotificationRespondRequest;
use App\Http\Resources\Api\V1\CalendarSchedulingNotificationResource;
use App\Services\Calendars\CalendarSchedulingNotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

final class CalendarSchedulingNotificationsController
{
    public function __construct(private readonly CalendarSchedulingNotificationService $notifications) {}

    public function invitees(): JsonResponse
    {
        return response()->json($this->notifications->invitees());
    }

    public function index(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $payload = $this->notifications->list($principal['username']);

        return response()->json([
            'list' => CalendarSchedulingNotificationResource::collection($payload['list'])->resolve(),
        ]);
    }

    public function respond(
        CalendarSchedulingNotificationRespondRequest $request,
        string $notificationId,
    ): JsonResponse {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $validated = $request->validated();
        $status = $validated['participationStatus'] ?? null;
        if (! is_string($status) || $status === '') {
            abort(422, 'participationStatus is required.');
        }
        $payload = ['participationStatus' => $status];
        if (array_key_exists('calendarId', $validated)) {
            $calendarId = $validated['calendarId'];
            if ($calendarId !== null && ! is_string($calendarId)) {
                abort(422, 'calendarId must be a string.');
            }
            $payload['calendarId'] = $calendarId;
        }
        if (array_key_exists('recurrenceId', $validated)) {
            $recurrenceId = $validated['recurrenceId'];
            if ($recurrenceId !== null && ! is_string($recurrenceId)) {
                abort(422, 'recurrenceId must be a string.');
            }
            $payload['recurrenceId'] = $recurrenceId;
        }
        if (array_key_exists('scope', $validated)) {
            $scope = $validated['scope'];
            if ($scope !== null && ! is_string($scope)) {
                abort(422, 'scope must be a string.');
            }
            $payload['scope'] = $scope;
        }
        $notification = $this->notifications->respond(
            $principal['username'],
            $notificationId,
            $payload,
        );

        return (new CalendarSchedulingNotificationResource($notification))->response();
    }

    public function destroy(Request $request, string $notificationId): Response
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->notifications->dismiss($principal['username'], $notificationId);

        return response()->noContent();
    }
}
