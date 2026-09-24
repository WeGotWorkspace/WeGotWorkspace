<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Services\Mcp\McpPublicOrigin;
use App\Services\Mcp\McpScopes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class OAuthMetadataController
{
    public function authorizationServer(Request $request): JsonResponse
    {
        $origin = McpPublicOrigin::for($request);

        return response()->json([
            'issuer' => $origin,
            'authorization_endpoint' => $origin.'/oauth/authorize',
            'token_endpoint' => $origin.'/oauth/token',
            'registration_endpoint' => $origin.'/oauth/register',
            'response_types_supported' => ['code'],
            'code_challenge_methods_supported' => ['S256'],
            'grant_types_supported' => ['authorization_code', 'refresh_token'],
            'token_endpoint_auth_methods_supported' => ['none'],
            'client_id_metadata_document_supported' => true,
            'scopes_supported' => McpScopes::ids(),
        ]);
    }

    public function protectedResource(Request $request, ?string $path = null): JsonResponse
    {
        $resourcePath = is_string($path) && $path !== '' ? $path : 'mcp';
        $origin = McpPublicOrigin::for($request);

        return response()->json([
            'resource' => $origin.'/'.$resourcePath,
            'authorization_servers' => [$origin],
            'scopes_supported' => McpScopes::ids(),
            'bearer_methods_supported' => ['header'],
        ]);
    }
}
