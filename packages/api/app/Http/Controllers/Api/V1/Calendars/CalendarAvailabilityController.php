<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Calendars\Availability\AvailabilitySettingsPayload;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** The caller's Team availability settings (switch, Teams, per-calendar choices). */
final class CalendarAvailabilityController
{
    public function __construct(private readonly AvailabilitySettingsPayload $settings) {}

    public function show(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return response()->json($this->settings->show($principal['username']));
    }

    public function update(Request $request): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $payload = json_decode((string) $request->getContent(), true);

        return response()->json($this->settings->update($principal['username'], $payload));
    }
}
