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
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            if (self::isCarrierGradeNat($ip)) {
                return false;
            }

            return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            return false;
        }
        if (self::isIpv4Mapped($ip)) {
            return false;
        }
        $embedded = self::embeddedTunnelIpv4($ip);
        if ($embedded !== null) {
            return self::isPublicIp($embedded);
        }

        return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) !== false;
    }

    /** RFC 6598 shared address space, including Alibaba metadata 100.100.100.200. */
    private static function isCarrierGradeNat(string $ip): bool
    {
        $packed = inet_pton($ip);
        $network = inet_pton('100.64.0.0');
        if ($packed === false || $network === false || strlen($packed) !== 4) {
            return false;
        }
        $addr = unpack('N', $packed);
        $base = unpack('N', $network);
        if ($addr === false || $base === false) {
            return false;
        }

        return ($addr[1] & 0xFFC00000) === ($base[1] & 0xFFC00000);
    }

    /**
     * PHP 8.3 filter_var accepts every ::ffff:0:0/96 address, including loopback.
     * PHP 8.5 rejects the whole prefix. Keep that fail-closed behavior on both.
     */
    private static function isIpv4Mapped(string $ip): bool
    {
        $packed = inet_pton($ip);
        $prefix = inet_pton('::ffff:0:0');
        if ($packed === false || $prefix === false || strlen($packed) !== 16) {
            return false;
        }

        return substr($packed, 0, 12) === substr($prefix, 0, 12);
    }

    /**
     * IPv4 embedded in NAT64 (64:ff9b::/96) or 6to4 (2002::/16).
     */
    private static function embeddedTunnelIpv4(string $ip): ?string
    {
        $packed = inet_pton($ip);
        if ($packed === false || strlen($packed) !== 16) {
            return null;
        }
        $nat64 = inet_pton('64:ff9b::');
        $ipv4 = null;
        if ($nat64 !== false && substr($packed, 0, 12) === substr($nat64, 0, 12)) {
            $ipv4 = substr($packed, 12, 4);
        } elseif (substr($packed, 0, 2) === "\x20\x02") {
            $ipv4 = substr($packed, 2, 4);
        }
        if ($ipv4 === null) {
            return null;
        }
        $text = inet_ntop($ipv4);

        return $text === false ? null : $text;
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
