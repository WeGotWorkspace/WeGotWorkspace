<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Services\Mcp\McpScopes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class OAuthMetadataController
{
    public function authorizationServer(): JsonResponse
    {
        return response()->json([
            'issuer' => url('/'),
            'authorization_endpoint' => url('/oauth/authorize'),
            'token_endpoint' => url('/oauth/token'),
            'registration_endpoint' => url('/oauth/register'),
            'response_types_supported' => ['code'],
            'code_challenge_methods_supported' => ['S256'],
            'grant_types_supported' => ['authorization_code', 'refresh_token'],
            'token_endpoint_auth_methods_supported' => ['none'],
            'scopes_supported' => McpScopes::ids(),
        ]);
    }

    public function protectedResource(Request $request, ?string $path = null): JsonResponse
    {
        $resourcePath = is_string($path) && $path !== '' ? $path : 'mcp';

        return response()->json([
            'resource' => url('/'.$resourcePath),
            'authorization_servers' => [url('/')],
            'scopes_supported' => McpScopes::ids(),
            'bearer_methods_supported' => ['header'],
        ]);
    }
}
