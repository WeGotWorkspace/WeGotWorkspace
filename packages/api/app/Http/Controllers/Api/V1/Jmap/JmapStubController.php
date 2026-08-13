<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use Illuminate\Http\JsonResponse;

/**
 * The one structurally-required Session URL that stays unimplemented:
 * eventSourceUrl (JMAP Push, RFC 8620 §7) is an explicit non-goal — clients
 * poll. Upload/download moved to JmapBlobController (#438).
 */
final class JmapStubController
{
    public function eventSource(): JsonResponse
    {
        return response()->json([
            'error' => 'Not implemented.',
            'code' => 'not_implemented',
        ], 501);
    }
}
