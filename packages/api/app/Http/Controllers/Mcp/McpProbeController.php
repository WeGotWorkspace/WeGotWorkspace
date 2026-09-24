<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Services\Mcp\McpPublicOrigin;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class McpProbeController
{
    public function challenge(Request $request): JsonResponse
    {
        return McpPublicOrigin::unauthorized($request);
    }

    public function options(): Response
    {
        return response('', 204);
    }
}
