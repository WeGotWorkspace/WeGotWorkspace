<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Rtc;

use App\Http\Requests\Api\V1\RtcSessionMetricRequest;
use Illuminate\Http\JsonResponse;

/**
 * Ingest for anonymous real-time session samples.
 *
 * The contract and the `rtc_session_metrics` table ship with the signaling
 * hardening so clients have a stable endpoint, but the row is written together
 * with the real-time health page that reads it (#1096). Until then a valid
 * sample is accepted and dropped: reporting clients must not have to treat the
 * health page as a hard dependency.
 */
final class MetricsController
{
    public function __invoke(RtcSessionMetricRequest $request): JsonResponse
    {
        $request->validated();

        return response()->json(null, 202);
    }
}
