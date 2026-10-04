<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Rtc;

use App\Http\Requests\Api\V1\RtcSessionMetricRequest;
use App\Services\Rtc\RtcSessionMetricIngest;
use Illuminate\Http\JsonResponse;

/**
 * Ingest for anonymous real-time session samples.
 *
 * A signed-in account or a live guest session may report. The stored row is
 * the allow-list on `rtc_session_metrics`: no address, room name, or user id.
 */
final class MetricsController
{
    public function __invoke(RtcSessionMetricRequest $request, RtcSessionMetricIngest $ingest): JsonResponse
    {
        if (! $ingest->actorMayReport($request)) {
            return response()->json([
                'error' => 'Sign in or re-open the guest join link to report a session.',
                'code' => 'unauthorized',
            ], 401);
        }

        $ingest->store($request->validated());

        return response()->json(null, 202);
    }
}
