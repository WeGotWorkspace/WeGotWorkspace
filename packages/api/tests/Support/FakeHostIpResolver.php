<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Calendars\HostIpResolver;

/**
 * Test double that maps hostnames to fixed addresses (no real DNS).
 */
final class FakeHostIpResolver extends HostIpResolver
{
    /** @var array<string, list<string>> */
    private array $hosts = [];

    /**
     * @param  list<string>  $ips
     */
    public function map(string $host, array $ips): self
    {
        $this->hosts[$this->normalizeHost($host)] = $ips;

        return $this;
    }

    /**
     * @return list<string>
     */
    public function resolve(string $host): array
    {
        $host = $this->normalizeHost($host);
        if (isset($this->hosts[$host])) {
            return $this->hosts[$host];
        }
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        return ['93.184.216.34'];
    }
}
