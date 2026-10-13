<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * An admin-confirmed public address. Never derived from the request Host.
 */
final class AppUrlCandidate
{
    /**
     * http/https, host required, no userinfo, query, or fragment.
     * The path is empty or exactly the install base.
     */
    public static function normalize(string $url, string $installBase): ?string
    {
        $url = trim($url);
        if ($url === '' || preg_match('/[\s\\\\@?#\x00-\x1F\x7F]/', $url) === 1) {
            return null;
        }

        $parts = parse_url($url);
        if (! is_array($parts)) {
            return null;
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if ($scheme !== 'http' && $scheme !== 'https') {
            return null;
        }
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            return null;
        }

        $host = $parts['host'] ?? null;
        if (! is_string($host) || $host === '') {
            return null;
        }

        $path = self::canonicalPath((string) ($parts['path'] ?? ''));
        $base = self::canonicalPath($installBase);
        if ($path === null || $base === null || ($path !== '/' && $path !== $base)) {
            return null;
        }

        $port = isset($parts['port']) ? ':'.$parts['port'] : '';
        $suffix = $path === '/' ? '' : $path;

        return $scheme.'://'.$host.$port.$suffix;
    }

    private static function canonicalPath(string $path): ?string
    {
        $path = trim($path);
        if ($path === '' || $path === '/') {
            return '/';
        }
        if (str_contains($path, '//')) {
            return null;
        }

        $trimmed = trim($path, '/');
        if ($trimmed === '' || str_contains($trimmed, '..')) {
            return null;
        }

        return '/'.$trimmed;
    }
}
