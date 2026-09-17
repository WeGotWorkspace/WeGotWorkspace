<?php

declare(strict_types=1);

namespace App\Services\Mcp;

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

    private static function forwardedPublicOrigin(Request $request): ?string
    {
        $host = self::firstForwardedHost($request);
        if ($host === null) {
            return null;
        }
        $proto = strtolower(trim((string) $request->headers->get('X-Forwarded-Proto', '')));
        if ($proto === '') {
            $proto = self::forwardedProto($request) ?? '';
        }
        $scheme = $proto === 'http' ? 'http' : 'https';
        $host = self::stripStandardPort($host, $scheme);
        if (! self::isPublicHostname($host)) {
            return null;
        }

        return $scheme.'://'.$host;
    }

    private static function firstForwardedHost(Request $request): ?string
    {
        foreach (['X-Forwarded-Host', 'X-Original-Host'] as $header) {
            $raw = $request->headers->get($header);
            if (! is_string($raw) || trim($raw) === '') {
                continue;
            }
            $host = strtolower(trim(explode(',', $raw)[0]));
            if ($host !== '') {
                return $host;
            }
        }

        $forwarded = $request->headers->get('Forwarded');
        if (! is_string($forwarded) || trim($forwarded) === '') {
            return null;
        }
        foreach (explode(',', $forwarded) as $hop) {
            if (preg_match('/host\s*=\s*"?([^;";]+)"?/i', $hop, $match) === 1) {
                $host = strtolower(trim($match[1]));
                if ($host !== '') {
                    return $host;
                }
            }
        }

        return null;
    }

    private static function forwardedProto(Request $request): ?string
    {
        $forwarded = $request->headers->get('Forwarded');
        if (! is_string($forwarded) || preg_match('/proto\s*=\s*"?([a-z]+)"?/i', $forwarded, $match) !== 1) {
            return null;
        }

        return strtolower($match[1]);
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

    private static function isPublicHostname(string $host): bool
    {
        $hostname = $host;
        $bracket = strrpos($host, ']');
        if (str_starts_with($host, '[') && $bracket !== false) {
            $hostname = substr($host, 1, $bracket - 1);
        } elseif (! str_starts_with($host, '[')) {
            $colon = strrpos($host, ':');
            if ($colon !== false && ctype_digit(substr($host, $colon + 1))) {
                $hostname = substr($host, 0, $colon);
            }
        }
        if ($hostname === '' || $hostname === 'localhost' || str_ends_with($hostname, '.localhost')) {
            return false;
        }
        if (filter_var($hostname, FILTER_VALIDATE_IP)) {
            return McpRedirectUris::isPublicIp($hostname);
        }

        return ! str_ends_with($hostname, '.local');
    }
}
