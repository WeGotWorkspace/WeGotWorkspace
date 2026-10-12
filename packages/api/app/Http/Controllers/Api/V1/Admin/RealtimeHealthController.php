<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Admin;

use App\Services\Rtc\RtcRealtimeHealthService;
use Illuminate\Http\JsonResponse;

final class RealtimeHealthController
{
    public function __construct(private RtcRealtimeHealthService $health) {}

    public function __invoke(): JsonResponse
    {
        return response()->json($this->health->snapshot());
    }
}
