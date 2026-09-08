<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class McpPublicOrigin
{
    public static function for(Request $request): string
    {
        return rtrim($request->getSchemeAndHttpHost(), '/');
    }

    public static function absolute(Request $request, string $path): string
    {
        return self::for($request).'/'.ltrim($path, '/');
    }

    public static function wwwAuthenticate(Request $request): string
    {
        return 'Bearer realm="mcp", resource_metadata="'.self::absolute(
            $request,
            '.well-known/oauth-protected-resource/mcp',
        ).'"';
    }

    public static function unauthorized(Request $request): JsonResponse
    {
        return response()->json([
            'jsonrpc' => '2.0',
            'id' => null,
            'error' => [
                'code' => -32001,
                'message' => 'Unauthorized.',
            ],
        ], 401)->header('WWW-Authenticate', self::wwwAuthenticate($request));
    }
}
