<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Rejects installer database hosts that are, or resolve to, IPv4 link-local
 * (169.254.0.0/16). Localhost and private ranges stay allowed.
 */
final class InstallerDatabaseHostGuard
{
    public const MESSAGE = 'That database host is not allowed.';

    public function __construct(private InstallerIpv4Resolver $resolver) {}

    /**
     * @param  array<string, mixed>  $db
     */
    public function blockMessage(array $db): ?string
    {
        if (($db['driver'] ?? '') !== 'mysql') {
            return null;
        }

        $host = $db['mysql_host'] ?? '';
        if (! is_string($host)) {
            return null;
        }

        $host = trim($host);
        if ($host === '') {
            return null;
        }

        if ($this->isLinkLocalHost($host)) {
            return self::MESSAGE;
        }

        return null;
    }

    private function isLinkLocalHost(string $host): bool
    {
        $literal = $this->literalIpv4($host);
        if ($literal !== null) {
            return $this->isLinkLocal($literal);
        }

        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return false;
        }

        foreach ($this->resolver->lookup($host) as $ip) {
            if ($this->isLinkLocal($ip)) {
                return true;
            }
        }

        return false;
    }

    private function literalIpv4(string $host): ?string
    {
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }
        $host = rtrim($host, '.');

        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            return $host;
        }

        if (preg_match('/\A(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)\z/i', $host, $dotted) === 1) {
            $ipv4 = $dotted[1];
            if (filter_var($ipv4, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
                return null;
            }

            return $ipv4;
        }

        if (preg_match('/\A::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\z/i', $host, $mapped) !== 1) {
            return null;
        }

        $hi = $this->hex16($mapped[1]);
        $lo = $this->hex16($mapped[2]);
        if ($hi === null || $lo === null) {
            return null;
        }

        $ip = long2ip(($hi << 16) | $lo);

        return is_string($ip) ? $ip : null;
    }

    private function hex16(mixed $hex): ?int
    {
        if (! is_string($hex)) {
            return null;
        }

        $value = hexdec($hex);
        if (! is_int($value) || $value < 0 || $value > 0xFFFF) {
            return null;
        }

        return $value;
    }

    private function isLinkLocal(string $ip): bool
    {
        $packed = inet_pton($ip);
        if ($packed === false || strlen($packed) !== 4) {
            return false;
        }

        return $packed[0] === "\xA9" && $packed[1] === "\xFE";
    }
}
