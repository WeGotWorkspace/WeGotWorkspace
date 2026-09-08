<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;

final class CimdResolver
{
    /** MySQL utf8mb4 InnoDB unique indexes cannot exceed 3072 bytes. */
    public const URL_MAX_LENGTH = 768;

    public function __construct(
        private ClientRepository $clients,
        private PublicHostResolver $dns,
        private McpClientGarbageCollector $gc,
    ) {}

    public function looksLikeMetadataUrl(string $clientId): bool
    {
        return str_starts_with(strtolower($clientId), 'https://');
    }

    public function resolve(string $clientId): Client
    {
        if (! $this->looksLikeMetadataUrl($clientId)) {
            throw new CimdException('client_id is not a CIMD metadata URL.', 400);
        }
        if (strlen($clientId) > self::URL_MAX_LENGTH) {
            throw new CimdException('CIMD client_id exceeds maximum length.', 400);
        }

        $this->gc->prune();

        $existing = Passport::client()->newQuery()->where('cimd_url', $clientId)->first();
        $ttlHours = (int) config('mcp.cimd.client_ttl_hours', 24);
        if ($existing instanceof Client) {
            $fetchedAt = $existing->getAttribute('cimd_fetched_at');
            if ($fetchedAt !== null && $fetchedAt->gt(now()->subHours(max(1, $ttlHours)))) {
                return $existing;
            }
        }

        $metadata = $this->fetch($clientId);
        $redirectUris = $this->validatedRedirectUris($metadata);
        $name = $this->clientName($metadata, $clientId);
        $origin = McpRedirectUris::originOf($clientId);

        if ($existing instanceof Client) {
            $existing->forceFill([
                'name' => $name,
                'redirect_uris' => $redirectUris,
                'grant_types' => ['authorization_code', 'refresh_token'],
                'revoked' => false,
                'cimd_origin' => $origin,
                'cimd_fetched_at' => now(),
                'provider' => 'users',
            ])->save();

            return $existing->refresh();
        }

        $client = $this->clients->createAuthorizationCodeGrantClient(
            name: $name,
            redirectUris: $redirectUris,
            confidential: false,
            enableDeviceFlow: false,
        );
        $client->forceFill([
            'cimd_url' => $clientId,
            'cimd_origin' => $origin,
            'cimd_fetched_at' => now(),
            'provider' => 'users',
            'scopes' => McpScopes::ids(),
        ])->save();

        return $client->refresh();
    }

    /**
     * @return array<string, mixed>
     */
    public function fetch(string $url): array
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ($parts['scheme'] ?? '') !== 'https') {
            throw new CimdException('CIMD client_id must be an https URL.', 400);
        }
        $host = (string) ($parts['host'] ?? '');
        if ($host === '' || strtolower($host) === 'localhost') {
            throw new CimdException('CIMD host is not allowed.', 400);
        }
        $port = (int) ($parts['port'] ?? 443);
        $origin = McpRedirectUris::originOf($url);

        $throttleKey = 'mcp-cimd:'.sha1($origin);
        if (RateLimiter::tooManyAttempts($throttleKey, 20)) {
            throw new CimdException('Too many CIMD fetches for this origin.', 429);
        }
        RateLimiter::hit($throttleKey, 60);

        $ips = $this->dns->resolve($host);
        if ($ips === []) {
            throw new CimdException('CIMD host could not be resolved.', 400);
        }
        $public = array_values(array_filter($ips, McpRedirectUris::isPublicIp(...)));
        if ($public === []) {
            throw new CimdException('CIMD host resolved to a private or reserved address.', 400);
        }
        $pinned = $public[0];
        $timeout = (int) config('mcp.cimd.timeout_seconds', 5);
        $maxBytes = (int) config('mcp.cimd.max_bytes', 65536);

        try {
            $response = Http::withOptions([
                'allow_redirects' => false,
                'timeout' => $timeout,
                'connect_timeout' => $timeout,
                'curl' => [
                    CURLOPT_RESOLVE => [$host.':'.$port.':'.$pinned],
                    CURLOPT_PROTOCOLS => defined('CURLPROTO_HTTPS') ? CURLPROTO_HTTPS : 2,
                ],
            ])
                ->withHeaders([
                    'Accept' => 'application/json',
                    'User-Agent' => 'WeGotWorkspace-CIMD/1.0',
                ])
                ->get($url);
        } catch (ConnectionException $e) {
            throw new CimdException('CIMD metadata could not be fetched.', 400, $e);
        }

        if ($response->status() !== 200) {
            throw new CimdException('CIMD metadata fetch failed.', 400);
        }
        $contentType = strtolower((string) $response->header('Content-Type'));
        if (! str_contains($contentType, 'application/json') && ! str_contains($contentType, '+json')) {
            throw new CimdException('CIMD metadata must be application/json.', 400);
        }
        $body = $response->body();
        if (strlen($body) > $maxBytes) {
            throw new CimdException('CIMD metadata exceeds size limit.', 400);
        }
        $decoded = json_decode($body, true);
        if (! is_array($decoded)) {
            throw new CimdException('CIMD metadata is not valid JSON.', 400);
        }

        if (! in_array('none', $this->authMethods($decoded), true)) {
            throw new CimdException('CIMD token_endpoint_auth_method must include none.', 400);
        }

        return $decoded;
    }

    /**
     * @param  array<string, mixed>  $metadata
     * @return list<string>
     */
    private function validatedRedirectUris(array $metadata): array
    {
        $uris = $metadata['redirect_uris'] ?? [];
        if (! is_array($uris) || $uris === []) {
            throw new CimdException('CIMD metadata is missing redirect_uris.', 400);
        }
        $validated = [];
        foreach ($uris as $uri) {
            if (! is_string($uri) || ! McpRedirectUris::isAllowed($uri)) {
                throw new CimdException('CIMD redirect_uris include a disallowed URI.', 400);
            }
            $validated[] = $uri;
        }

        return array_values(array_unique($validated));
    }

    /**
     * @param  array<string, mixed>  $metadata
     */
    private function clientName(array $metadata, string $clientId): string
    {
        $name = $metadata['client_name'] ?? $metadata['name'] ?? null;
        if (is_string($name) && trim($name) !== '') {
            return mb_substr(trim($name), 0, 255);
        }

        return McpRedirectUris::originOf($clientId);
    }

    /**
     * @param  array<string, mixed>  $metadata
     * @return list<string>
     */
    private function authMethods(array $metadata): array
    {
        $raw = $metadata['token_endpoint_auth_methods']
            ?? $metadata['token_endpoint_auth_methods_supported']
            ?? $metadata['token_endpoint_auth_method']
            ?? ['none'];
        if (is_string($raw)) {
            return [$raw];
        }
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach ($raw as $item) {
            if (is_string($item) && $item !== '') {
                $out[] = $item;
            }
        }

        return $out;
    }
}
