<?php

declare(strict_types=1);

namespace App\Http\Controllers\Mcp;

use App\Services\Mcp\McpRedirectUris;
use App\Services\Mcp\McpScopes;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Passport\ClientRepository;

final class OAuthRegisterController
{
    public function __construct(private ClientRepository $clients) {}

    public function __invoke(Request $request): JsonResponse
    {
        $name = $request->input('client_name') ?? $request->input('name');
        $uris = $request->input('redirect_uris');
        if (! is_array($uris) || $uris === []) {
            return response()->json([
                'error' => 'invalid_redirect_uri',
                'error_description' => 'redirect_uris is required.',
            ], 400);
        }
        foreach ($uris as $uri) {
            if (! is_string($uri) || ! McpRedirectUris::isAllowed($uri)) {
                return response()->json([
                    'error' => 'invalid_redirect_uri',
                    'error_description' => 'redirect_uris must be https or loopback IP literals.',
                ], 400);
            }
        }
        $clientName = is_string($name) && trim($name) !== ''
            ? mb_substr(trim($name), 0, 255)
            : (parse_url((string) $uris[0], PHP_URL_HOST) ?: 'MCP Client');

        $client = $this->clients->createAuthorizationCodeGrantClient(
            name: (string) $clientName,
            redirectUris: array_values($uris),
            confidential: false,
            enableDeviceFlow: false,
        );
        $client->forceFill([
            'provider' => 'users',
            'scopes' => McpScopes::clientAllowlist(),
            'cimd_origin' => McpRedirectUris::originOf((string) $uris[0]),
        ])->save();

        return response()->json([
            'client_id' => (string) $client->id,
            'grant_types' => $client->grant_types,
            'response_types' => ['code'],
            'redirect_uris' => $client->redirect_uris,
            'token_endpoint_auth_method' => 'none',
            'scope' => implode(' ', McpScopes::ids()),
        ], 201);
    }
}
