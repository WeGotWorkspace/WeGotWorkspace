<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Calendars;

use App\Http\Middleware\AuthenticateWgwApi;
use App\Services\Calendars\Availability\PublicLink\AvailabilityPublicFeedService;
use App\Services\Calendars\Availability\PublicLink\AvailabilityPublicLinkService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

/** The caller's public availability link, and the unauthenticated feed behind it (#2405). */
final class AvailabilityPublicLinkController
{
    public function __construct(
        private readonly AvailabilityPublicLinkService $links,
        private readonly AvailabilityPublicFeedService $feed,
    ) {}

    public function show(Request $request): JsonResponse
    {
        return response()->json($this->links->show(self::username($request)));
    }

    public function store(Request $request): JsonResponse
    {
        $result = $this->links->enable(self::username($request));

        return response()->json($result['link'], $result['created'] ? 201 : 200);
    }

    public function regenerate(Request $request): JsonResponse
    {
        return response()->json($this->links->regenerate(self::username($request)));
    }

    public function destroy(Request $request): Response
    {
        $this->links->disable(self::username($request));

        return response()->noContent();
    }

    public function publicShow(Request $request, string $token): SymfonyResponse
    {
        $ics = $this->feed->ics($token, (string) $request->ip());
        $etag = '"'.substr(hash('sha256', $ics), 0, 32).'"';
        $headers = [
            'ETag' => $etag,
            'Cache-Control' => 'no-cache',
            'X-Robots-Tag' => 'noindex',
        ];
        if (in_array($etag, array_map('trim', explode(',', (string) $request->header('If-None-Match'))), true)) {
            return response('', 304, $headers);
        }

        return response($ics, 200, $headers + ['Content-Type' => 'text/calendar; charset=utf-8']);
    }

    private static function username(Request $request): string
    {
        $principal = $request->attributes->get(AuthenticateWgwApi::PRINCIPAL_ATTRIBUTE);

        return (string) $principal['username'];
    }
}
