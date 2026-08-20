<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Requests\Api\V1\CalendarSchedulingNotificationRespondRequest;
use App\Services\Calendars\CalendarRsvpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CalendarRsvpController
{
    public function __construct(private readonly CalendarRsvpService $rsvp) {}

    public function show(Request $request, string $token): JsonResponse
    {
        return response()->json($this->rsvp->show($token, (string) $request->ip()));
    }

    public function respond(CalendarSchedulingNotificationRespondRequest $request, string $token): JsonResponse
    {
        return response()->json($this->rsvp->respond($token, $request->validated(), (string) $request->ip()));
    }
}
