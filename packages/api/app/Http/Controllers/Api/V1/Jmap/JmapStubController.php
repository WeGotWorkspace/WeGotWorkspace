<?php

declare(strict_types=1);

namespace App\Http\Controllers\Api\V1\Jmap;

use Illuminate\Http\JsonResponse;

/**
 * Structurally-required Session URLs (downloadUrl/uploadUrl/eventSourceUrl)
 * that nothing in the shipped calendar client calls: valid-shaped routes
 * returning 501, per spec §2 (blob handling and push are non-goals).
 */
final class JmapStubController
{
    public function download(): JsonResponse
    {
        return $this->notImplemented();
    }

    public function upload(): JsonResponse
    {
        return $this->notImplemented();
    }

    public function eventSource(): JsonResponse
    {
        return $this->notImplemented();
    }

    private function notImplemented(): JsonResponse
    {
        return response()->json([
            'error' => 'Not implemented.',
            'code' => 'not_implemented',
        ], 501);
    }
}
