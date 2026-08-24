<?php

declare(strict_types=1);

namespace App\Services\Calendars;

/**
 * Resolves a hostname (or literal IP) to addresses for SSRF checks.
 */
class HostIpResolver
{
    /**
     * @return list<string>
     */
    public function resolve(string $host): array
    {
        $host = $this->normalizeHost($host);
        if ($host === '') {
            return [];
        }

        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        $ipv4 = gethostbynamel($host);
        if ($ipv4 === false) {
            return [];
        }

        return array_values(array_unique($ipv4));
    }

    public function normalizeHost(string $host): string
    {
        $host = strtolower(trim($host));
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            return substr($host, 1, -1);
        }

        return $host;
    }
}
