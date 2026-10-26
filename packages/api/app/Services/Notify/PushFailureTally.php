<?php

declare(strict_types=1);

namespace App\Services\Notify;

use Illuminate\Container\Attributes\Singleton;

/**
 * Counts failed Web Push sends by status and push-service host, so the sweep
 * command can log one summary per run. Holds hosts only, never endpoints.
 */
#[Singleton]
final class PushFailureTally
{
    /** @var array<int, int> */
    private array $byStatus = [];

    /** @var array<string, int> */
    private array $byHost = [];

    /**
     * @param  int  $status  HTTP status from the push service, 0 when no response arrived
     */
    public function record(string $host, int $status): void
    {
        $this->byStatus[$status] = ($this->byStatus[$status] ?? 0) + 1;
        $this->byHost[$host] = ($this->byHost[$host] ?? 0) + 1;
    }

    public function reset(): void
    {
        $this->byStatus = [];
        $this->byHost = [];
    }

    public function hasFailures(): bool
    {
        return $this->byStatus !== [];
    }

    /**
     * @return array{failed: int, by_status: array<int, int>, by_host: array<string, int>}
     */
    public function summary(): array
    {
        $byStatus = $this->byStatus;
        ksort($byStatus);
        $byHost = $this->byHost;
        ksort($byHost);

        return [
            'failed' => array_sum($byStatus),
            'by_status' => $byStatus,
            'by_host' => $byHost,
        ];
    }
}
