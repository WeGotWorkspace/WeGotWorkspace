<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Support\PublicAppUrl;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class McpPublicOrigin
{
    public static function for(Request $request): string
    {
        $configured = self::configuredOrigin();
        if ($configured !== null) {
            return $configured;
        }

        $forwarded = self::forwardedPublicOrigin($request);
        if ($forwarded !== null) {
            return $forwarded;
        }

        return rtrim($request->getSchemeAndHttpHost(), '/');
    }

    /**
     * Local-tunnel origin from {@code WGW_MCP_PUBLIC_ORIGIN}. Null in production
     * and when the value is missing or not a public http(s) origin.
     */
    public static function configuredOrigin(): ?string
    {
        if (self::isProduction()) {
            return null;
        }
        $raw = config('wgw.mcp.public_origin');
        if (! is_string($raw)) {
            return null;
        }
        $origin = rtrim(trim($raw), '/');
        if ($origin === '') {
            return null;
        }
        $scheme = strtolower((string) parse_url($origin, PHP_URL_SCHEME));
        if ($scheme !== 'https' && $scheme !== 'http') {
            return null;
        }
        if (! self::isPublicOrigin($origin)) {
            return null;
        }

        return $origin;
    }

    public static function configuredEndpointUrl(): ?string
    {
        $origin = self::configuredOrigin();

        return $origin === null ? null : $origin.'/mcp';
    }

    public static function isPublicOrigin(string $origin): bool
    {
        $host = parse_url($origin, PHP_URL_HOST);

        return is_string($host) && $host !== '' && self::isPublicHostname($host);
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

    private static function isProduction(): bool
    {
        return app()->environment('production')
            || (string) config('app.env') === 'production';
    }

    /**
     * X-Forwarded-Host is applied by {@code getSchemeAndHttpHost()} only when
     * the direct client is a trusted proxy, and TrustHosts then limits the
     * name. {@code Forwarded} is not trusted; the {@code trustProxies} header
     * mask omits {@code HEADER_FORWARDED}. X-Original-Host is not one of those
     * headers, so a trusted proxy may still set it when X-Forwarded-Host is
     * absent. The name must be a public hostname on
     * {@see PublicAppUrl::trustedHostPatterns()} when that list is non-empty.
     * An empty list means no Host restriction, the same regime as the
     * X-Forwarded-Host path when APP_URL is unset or loopback.
     */
    private static function forwardedPublicOrigin(Request $request): ?string
    {
        if (! $request->isFromTrustedProxy()) {
            return null;
        }
        if (self::firstHeaderHost($request, 'X-Forwarded-Host') !== null) {
            return null;
        }

        $host = self::firstHeaderHost($request, 'X-Original-Host');
        if ($host === null) {
            return null;
        }
        $proto = strtolower(trim((string) $request->headers->get('X-Forwarded-Proto', '')));
        $scheme = $proto === 'http' ? 'http' : 'https';
        $host = self::stripStandardPort($host, $scheme);
        if (! self::isPublicHostname($host) || ! self::isTrustedHost($host)) {
            return null;
        }

        return $scheme.'://'.$host;
    }

    private static function firstHeaderHost(Request $request, string $header): ?string
    {
        $raw = $request->headers->get($header);
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }
        $host = strtolower(trim(explode(',', $raw)[0]));

        return $host !== '' ? $host : null;
    }

    private static function stripStandardPort(string $host, string $scheme): string
    {
        if (str_starts_with($host, '[')) {
            return $host;
        }
        $colon = strrpos($host, ':');
        if ($colon === false) {
            return $host;
        }
        $port = substr($host, $colon + 1);
        if (($scheme === 'https' && $port === '443') || ($scheme === 'http' && $port === '80')) {
            return substr($host, 0, $colon);
        }

        return $host;
    }

    /**
     * An empty pattern list means no Host restriction is configured.
     */
    private static function isTrustedHost(string $host): bool
    {
        $patterns = PublicAppUrl::trustedHostPatterns();
        if ($patterns === []) {
            return true;
        }
        $hostname = self::hostnameWithoutPort($host);
        foreach ($patterns as $pattern) {
            if (preg_match('{'.$pattern.'}i', $hostname) === 1) {
                return true;
            }
        }

        return false;
    }

    private static function hostnameWithoutPort(string $host): string
    {
        $bracket = strrpos($host, ']');
        if (str_starts_with($host, '[') && $bracket !== false) {
            return substr($host, 1, $bracket - 1);
        }
        if (! str_starts_with($host, '[')) {
            $colon = strrpos($host, ':');
            if ($colon !== false && ctype_digit(substr($host, $colon + 1))) {
                return substr($host, 0, $colon);
            }
        }

        return $host;
    }

    private static function isPublicHostname(string $host): bool
    {
        $hostname = self::hostnameWithoutPort($host);
        if ($hostname === '' || $hostname === 'localhost' || str_ends_with($hostname, '.localhost')) {
            return false;
        }
        if (filter_var($hostname, FILTER_VALIDATE_IP)) {
            return McpRedirectUris::isPublicIp($hostname);
        }

        return ! str_ends_with($hostname, '.local');
    }
}
