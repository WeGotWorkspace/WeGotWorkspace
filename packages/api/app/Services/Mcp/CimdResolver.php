<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use GuzzleHttp\Exception\RequestException as GuzzleRequestException;
use GuzzleHttp\Exception\TransferException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;
use Throwable;

final class CimdResolver
{
    /** MySQL utf8mb4 InnoDB unique indexes cannot exceed 3072 bytes. */
    public const URL_MAX_LENGTH = 768;

    private const ORIGIN_FETCHES_PER_MINUTE = 20;

    private const IP_FETCHES_PER_MINUTE = 10;

    private const FETCH_DECAY_SECONDS = 60;

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
            $this->stampClientScopes($existing);
            $fetchedAt = $existing->getAttribute('cimd_fetched_at');
            if ($fetchedAt !== null && $fetchedAt->gt(now()->subHours(max(1, $ttlHours)))) {
                return $existing->refresh();
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
                'scopes' => McpScopes::clientAllowlist(),
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
            'scopes' => McpScopes::clientAllowlist(),
        ])->save();

        return $client->refresh();
    }

    /**
     * @return array<string, mixed>
     */
    public function fetch(string $url): array
    {
        $safe = $this->assertSafeCimdUrl($url);
        $url = $safe['url'];
        $host = $safe['host'];
        $port = $safe['port'];
        $pinned = $safe['pinnedIp'];
        $timeout = (int) config('mcp.cimd.timeout_seconds', 5);
        $maxBytes = (int) config('mcp.cimd.max_bytes', 65536);

        try {
            $response = Http::withOptions(self::httpOptions($host, $port, $pinned, $maxBytes))
                ->timeout($timeout)
                ->connectTimeout($timeout)
                ->withHeaders([
                    'Accept' => 'application/json',
                    'User-Agent' => 'WeGotWorkspace-CIMD/1.0',
                ])
                ->get($url);
        } catch (Throwable $e) {
            throw self::rethrowFetchFailure($e);
        }

        if ($response->status() !== 200) {
            throw new CimdException('CIMD metadata fetch failed.', 400);
        }
        $contentType = strtolower((string) $response->header('Content-Type'));
        if (! str_contains($contentType, 'application/json') && ! str_contains($contentType, '+json')) {
            throw new CimdException('CIMD metadata must be application/json.', 400);
        }
        $declared = $response->header('Content-Length');
        if (is_string($declared) && ctype_digit($declared) && (int) $declared > $maxBytes) {
            throw new CimdException('CIMD metadata exceeds size limit.', 400);
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
     * Validate https + public DNS for a CIMD metadata URL and return it for fetch.
     *
     * @return array{url: string, host: string, port: int, pinnedIp: string}
     *
     * @psalm-taint-escape ssrf
     */
    private function assertSafeCimdUrl(string $url): array
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
        $ipKey = self::requesterThrottleKey(request()->ip());
        if (RateLimiter::tooManyAttempts($throttleKey, self::ORIGIN_FETCHES_PER_MINUTE)) {
            throw new CimdException('Too many CIMD fetches for this origin.', 429);
        }
        if (RateLimiter::tooManyAttempts($ipKey, self::IP_FETCHES_PER_MINUTE)) {
            throw new CimdException('Too many CIMD fetches.', 429);
        }
        RateLimiter::hit($throttleKey, self::FETCH_DECAY_SECONDS);
        RateLimiter::hit($ipKey, self::FETCH_DECAY_SECONDS);

        $ips = $this->dns->resolve($host);
        if ($ips === []) {
            throw new CimdException('CIMD host could not be resolved.', 400);
        }
        $public = array_values(array_filter($ips, McpRedirectUris::isPublicIp(...)));
        if ($public === []) {
            throw new CimdException('CIMD host resolved to a private or reserved address.', 400);
        }

        return [
            'url' => $url,
            'host' => $host,
            'port' => $port,
            'pinnedIp' => $public[0],
        ];
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

    /**
     * @return array<string, mixed>
     */
    public static function httpOptions(string $host, int $port, string $pinned, int $maxBytes): array
    {
        return [
            'allow_redirects' => false,
            'protocols' => ['https'],
            'progress' => static function (int $downloadTotal, int $downloaded, int $uploadTotal, int $uploaded) use ($maxBytes): void {
                self::abortIfOversized($downloadTotal, $downloaded, $maxBytes);
            },
            'curl' => [
                CURLOPT_RESOLVE => [self::curlResolveEntry($host, $port, $pinned)],
            ],
        ];
    }

    public static function curlResolveEntry(string $host, int $port, string $pinned): string
    {
        $address = str_contains($pinned, ':') ? '['.trim($pinned, '[]').']' : $pinned;

        return $host.':'.$port.':'.$address;
    }

    public static function abortIfOversized(int $downloadTotal, int $downloaded, int $maxBytes): void
    {
        if ($downloadTotal > $maxBytes || $downloaded > $maxBytes) {
            throw new CimdException('CIMD metadata exceeds size limit.', 400);
        }
    }

    public static function fetchFailure(Throwable $error): CimdException
    {
        $nested = self::nestedCimd($error);
        if ($nested instanceof CimdException) {
            return $nested;
        }
        if (self::isCallbackAbort($error)) {
            return new CimdException('CIMD metadata exceeds size limit.', 400, $error);
        }

        return new CimdException('CIMD metadata could not be fetched.', 400, $error);
    }

    public static function requesterThrottleKey(?string $ip): string
    {
        $ip = trim((string) $ip, '[]');
        $mapped = self::mappedIpv4($ip);
        if ($mapped !== null) {
            return 'mcp-cimd-ip:'.$mapped;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return 'mcp-cimd-ip:'.$ip;
        }
        $prefix = self::ipv6Prefix64($ip);
        if ($prefix === null) {
            return 'mcp-cimd-ip:unknown';
        }

        return 'mcp-cimd-ip:'.$prefix;
    }

    private static function rethrowFetchFailure(Throwable $error): CimdException
    {
        if ($error instanceof CimdException
            || $error instanceof ConnectionException
            || $error instanceof RequestException
            || $error instanceof TransferException) {
            return self::fetchFailure($error);
        }

        throw $error;
    }

    private static function nestedCimd(Throwable $error): ?CimdException
    {
        for ($current = $error; $current instanceof Throwable; $current = $current->getPrevious()) {
            if ($current instanceof CimdException) {
                return $current;
            }
        }

        return null;
    }

    private static function isCallbackAbort(Throwable $error): bool
    {
        $abort = defined('CURLE_ABORTED_BY_CALLBACK') ? CURLE_ABORTED_BY_CALLBACK : 42;
        for ($current = $error; $current instanceof Throwable; $current = $current->getPrevious()) {
            if (! $current instanceof GuzzleRequestException) {
                continue;
            }
            $errno = $current->getHandlerContext()['errno'] ?? null;

            return is_int($errno) && $errno === $abort;
        }

        return false;
    }

    private static function mappedIpv4(string $ip): ?string
    {
        $packed = inet_pton($ip);
        $prefix = inet_pton('::ffff:0:0');
        if ($packed === false || $prefix === false || strlen($packed) !== 16) {
            return null;
        }
        if (substr($packed, 0, 12) !== substr($prefix, 0, 12)) {
            return null;
        }
        $text = inet_ntop(substr($packed, 12, 4));

        return $text === false ? null : $text;
    }

    private static function ipv6Prefix64(string $ip): ?string
    {
        $packed = inet_pton($ip);
        if ($packed === false || strlen($packed) !== 16) {
            return null;
        }
        $text = inet_ntop(substr($packed, 0, 8).str_repeat("\0", 8));

        return $text === false ? null : $text;
    }

    /**
     * Refresh Passport's per-client scope snapshot even when CIMD metadata is still cached.
     */
    private function stampClientScopes(Client $client): void
    {
        $wanted = McpScopes::clientAllowlist();
        $current = $client->scopes;
        $currentList = is_array($current) ? array_values($current) : [];
        if ($currentList === $wanted) {
            return;
        }
        $client->forceFill(['scopes' => $wanted])->save();
    }
}
