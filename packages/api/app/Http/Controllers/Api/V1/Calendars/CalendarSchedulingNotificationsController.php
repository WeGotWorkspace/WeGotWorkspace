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
        $notification = $this->notifications->respond(
            $principal['username'],
            $notificationId,
            $request->validated(),
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
