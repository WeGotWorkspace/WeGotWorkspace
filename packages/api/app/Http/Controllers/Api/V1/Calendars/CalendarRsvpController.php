<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Requests\Api\V1\CalendarSchedulingNotificationRespondRequest;
use App\Services\Calendars\CalendarRsvpService;
use Illuminate\Http\JsonResponse;

final class CalendarRsvpController
{
    public function __construct(private readonly CalendarRsvpService $rsvp) {}

    public function show(string $token): JsonResponse
    {
        return response()->json($this->rsvp->show($token));
    }

    public function respond(CalendarSchedulingNotificationRespondRequest $request, string $token): JsonResponse
    {
        return response()->json($this->rsvp->respond($token, $request->validated()));
    }
}
