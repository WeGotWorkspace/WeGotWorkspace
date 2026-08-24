<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Calendars\HostIpResolver;

/**
 * Test double that can return a different address list on each resolve()
 * for the same host (DNS rebinding / low-TTL race).
 */
final class SequentialHostIpResolver extends HostIpResolver
{
    /** @var array<string, list<list<string>>> */
    private array $queues = [];

    /** @var array<string, int> */
    private array $resolveCounts = [];

    /**
     * @param  list<string>  ...$results
     */
    public function queue(string $host, array ...$results): self
    {
        $this->queues[$this->normalizeHost($host)] = array_values($results);

        return $this;
    }

    public function resolveCount(string $host): int
    {
        return $this->resolveCounts[$this->normalizeHost($host)] ?? 0;
    }

    /**
     * @return list<string>
     */
    public function resolve(string $host): array
    {
        $host = $this->normalizeHost($host);
        $this->resolveCounts[$host] = ($this->resolveCounts[$host] ?? 0) + 1;

        if (isset($this->queues[$host]) && $this->queues[$host] !== []) {
            return array_shift($this->queues[$host]) ?? [];
        }
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return [$host];
        }

        return [];
    }
}
