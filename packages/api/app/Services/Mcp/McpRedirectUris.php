<?php

declare(strict_types=1);

namespace App\Services\Mcp;

final class McpRedirectUris
{
    public static function isAllowed(string $uri): bool
    {
        $parts = parse_url($uri);
        if (! is_array($parts)) {
            return false;
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        $host = trim($host, '[]');
        if ($scheme === 'https') {
            if ($host === '' || $host === 'localhost') {
                return false;
            }
            if (filter_var($host, FILTER_VALIDATE_IP)) {
                return self::isPublicIp($host);
            }

            return true;
        }
        if ($scheme === 'http') {
            // RFC 8252 native-app loopback. http to LAN or public hosts stays disallowed.
            return $host === '127.0.0.1' || $host === '::1' || $host === 'localhost';
        }

        return false;
    }

    public static function isPublicIp(string $ip): bool
    {
        $ip = trim($ip, '[]');
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false) {
            return true;
        }

        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
    }

    public static function originOf(string $url): string
    {
        $parts = parse_url($url);
        if (! is_array($parts) || ! isset($parts['scheme'], $parts['host'])) {
            return $url;
        }
        $origin = $parts['scheme'].'://'.$parts['host'];
        if (isset($parts['port'])) {
            $origin .= ':'.$parts['port'];
        }

        return $origin;
    }

    /** Host (+ port) for consent copy — no scheme. */
    public static function displayHost(string $origin): string
    {
        $parts = parse_url($origin);
        if (is_array($parts) && isset($parts['host']) && is_string($parts['host']) && $parts['host'] !== '') {
            $host = trim($parts['host'], '[]');
            if (isset($parts['port'])) {
                return $host.':'.$parts['port'];
            }

            return $host;
        }

        $stripped = preg_replace('#^https?://#i', '', $origin) ?? $origin;

        return rtrim($stripped, '/');
    }
}
