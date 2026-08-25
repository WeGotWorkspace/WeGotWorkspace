<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Calendars\CalendarEventRepository;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CalendarEventImportController
{
    public function __construct(private readonly CalendarEventRepository $events) {}

    public function __invoke(Request $request): JsonResponse
    {
        /** @var array{username: string, role: string} $principal */
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        $calendarId = $request->query('calendarId');
        if (! is_string($calendarId) || trim($calendarId) === '') {
            throw new ApiHttpException(400, 'calendarId is required.', 'bad_request');
        }

        $body = $request->getContent();
        if (! is_string($body) || trim($body) === '') {
            throw new ApiHttpException(400, 'ICS body is required.', 'bad_request');
        }

        $result = $this->events->importFromIcs(
            $principal['username'],
            $body,
            trim($calendarId),
        );

        $status = count($result['list']) > 0 ? 201 : 400;

        return response()->json($result, $status);
    }
}
