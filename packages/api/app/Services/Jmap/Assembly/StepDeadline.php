<?php

declare(strict_types=1);

namespace App\Services\Jmap\Assembly;

/**
 * Wall-time budget of one assembly step (#2249). The byte budget assumes a
 * storage throughput; on slower storage a step would run for as long as the
 * bytes take, and max_execution_time counts CPU time on Linux, so PHP never
 * stops a call that waits on I/O. Measured on the monotonic clock.
 */
final class StepDeadline
{
    private function __construct(private readonly int $endsAtNs) {}

    public static function in(float $seconds): self
    {
        return new self(hrtime(true) + (int) round(max(0.0, $seconds) * 1_000_000_000));
    }

    public function passed(): bool
    {
        return $this->passesWithin(0.0);
    }

    /**
     * Whether work that takes about $seconds from now would end past the
     * deadline.
     */
    public function passesWithin(float $seconds): bool
    {
        return hrtime(true) + (int) round(max(0.0, $seconds) * 1_000_000_000) >= $this->endsAtNs;
    }
}
