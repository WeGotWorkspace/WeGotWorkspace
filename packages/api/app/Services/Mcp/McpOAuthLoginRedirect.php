<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use Illuminate\Http\Request;

/**
 * Safe return from the PWA login screen to Passport `/oauth/authorize`.
 *
 * SPA JWT in localStorage is not a Laravel web session. Only `/oauth/authorize`
 * (same host) is an allowed `return` target.
 */
final class McpOAuthLoginRedirect
{
    public const AUTHORIZE_PATH = '/oauth/authorize';

    public static function spaLoginUrl(Request $request, ?string $intent = null, ?string $error = null): string
    {
        $query = [
            'return' => self::relativeAuthorize($request),
        ];
        if (is_string($intent) && $intent !== '') {
            $query['intent'] = $intent;
        }
        if (is_string($error) && $error !== '') {
            $query['error'] = $error;
        }

        return '/login?'.http_build_query($query);
    }

    public static function relativeAuthorize(Request $request): string
    {
        $intended = (string) $request->session()->get('url.intended', self::AUTHORIZE_PATH);

        return self::sanitize($intended, $request);
    }

    public static function sanitize(string $intended, Request $request): string
    {
        $intended = trim($intended);
        if ($intended === '') {
            return self::AUTHORIZE_PATH;
        }

        if (str_starts_with($intended, '/') && ! str_starts_with($intended, '//')) {
            return self::authorizeRelative($intended);
        }

        $parts = parse_url($intended);
        if (! is_array($parts) || ! isset($parts['host']) || ! is_string($parts['host'])) {
            return self::AUTHORIZE_PATH;
        }
        if (strcasecmp($parts['host'], $request->getHost()) !== 0) {
            return self::AUTHORIZE_PATH;
        }

        $path = (string) ($parts['path'] ?? self::AUTHORIZE_PATH);
        $query = isset($parts['query']) && is_string($parts['query']) && $parts['query'] !== ''
            ? '?'.$parts['query']
            : '';
        $fragment = isset($parts['fragment']) && is_string($parts['fragment']) && $parts['fragment'] !== ''
            ? '#'.$parts['fragment']
            : '';

        return self::authorizeRelative($path.$query.$fragment);
    }

    private static function authorizeRelative(string $relative): string
    {
        $path = parse_url($relative, PHP_URL_PATH);
        if ($path !== self::AUTHORIZE_PATH) {
            return self::AUTHORIZE_PATH;
        }

        return $relative;
    }
}
