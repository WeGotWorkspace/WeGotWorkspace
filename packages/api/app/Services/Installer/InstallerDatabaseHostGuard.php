<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * Rejects installer database hosts that are, or resolve to, IPv4 link-local
 * (169.254.0.0/16). Localhost and private ranges stay allowed.
 *
 * IPv4 only. gethostbynamel() does not see IPv6, so link-local and AAAA-only
 * names are outside this check.
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

        $packed = @inet_pton($host);
        if ($packed === false) {
            return null;
        }
        if (strlen($packed) === 4) {
            $canonical = inet_ntop($packed);

            return is_string($canonical) ? $canonical : null;
        }
        if (strlen($packed) === 16 && str_starts_with($packed, "\0\0\0\0\0\0\0\0\0\0\xff\xff")) {
            $canonical = inet_ntop(substr($packed, 12));

            return is_string($canonical) ? $canonical : null;
        }

        return null;
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
