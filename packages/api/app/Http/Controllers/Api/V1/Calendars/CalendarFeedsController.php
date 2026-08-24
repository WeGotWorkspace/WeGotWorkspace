<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Resources\Api\V1\CalendarFeedResource;
use App\Services\Calendars\CalendarFeedService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

final class CalendarFeedsController
{
    public function __construct(private readonly CalendarFeedService $feeds) {}

    public function show(Request $request, string $calendarId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (new CalendarFeedResource(
            $this->feeds->show($principal['username'], $calendarId),
        ))->response();
    }

    public function store(Request $request, string $calendarId): JsonResponse
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $result = $this->feeds->publish($principal['username'], $calendarId);

        return (new CalendarFeedResource($result['feed']))
            ->response()
            ->setStatusCode($result['created'] ? 201 : 200);
    }

    public function destroy(Request $request, string $calendarId): Response
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);
        $this->feeds->revoke($principal['username'], $calendarId);

        return response()->noContent();
    }

    public function publicShow(Request $request, string $token): SymfonyResponse
    {
        $ics = $this->feeds->publicIcs($token, (string) $request->ip());

        return response($ics, 200, [
            'Content-Type' => 'text/calendar; charset=utf-8',
            'Cache-Control' => 'no-store',
        ]);
    }
}
