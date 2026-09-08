<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class McpPublicOrigin
{
    public static function for(Request $request): string
    {
        $forwarded = self::forwardedPublicOrigin($request);
        if ($forwarded !== null) {
            return $forwarded;
        }

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

    private static function forwardedPublicOrigin(Request $request): ?string
    {
        $raw = $request->headers->get('X-Forwarded-Host');
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }
        $host = strtolower(trim(explode(',', $raw)[0]));
        $proto = strtolower(trim((string) $request->headers->get('X-Forwarded-Proto', '')));
        $scheme = $proto === 'http' ? 'http' : 'https';
        $host = self::stripStandardPort($host, $scheme);
        if (! self::isPublicHostname($host)) {
            return null;
        }

        return $scheme.'://'.$host;
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
