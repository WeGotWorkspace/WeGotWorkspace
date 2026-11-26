<?php

declare(strict_types=1);

namespace App\Services\Jmap;

/**
 * Per-request JMAP context: the `using` list of the batch being dispatched.
 * Methods read it for per-request gates (the FileNode version-check
 * capability) — capabilities only take effect when listed in `using`.
 *
 * It also remembers per-account reads every method call repeats (visible
 * roots, member grants, the change sequence) for the length of one batch
 * (#2063). The dispatcher forgets them after every call that may write, and
 * outside a batch nothing is remembered.
 */
final class JmapRequestContext
{
    /** @var list<string> */
    private array $using = [];

    /** @var array<string, mixed> */
    private array $remembered = [];

    private bool $inBatch = false;

    /**
     * Starts a batch: sets its `using` list and an empty memory.
     *
     * @param  list<string>  $using
     */
    public function setUsing(array $using): void
    {
        $this->using = array_values(array_filter($using, 'is_string'));
        $this->remembered = [];
        $this->inBatch = true;
    }

    public function endBatch(): void
    {
        $this->remembered = [];
        $this->inBatch = false;
    }

    /**
     * `$compute()` once per batch for `$key`; outside a batch, every time.
     *
     * @template T
     *
     * @param  callable(): T  $compute
     * @return T
     */
    public function remember(string $key, callable $compute): mixed
    {
        if (! $this->inBatch) {
            return $compute();
        }
        if (! array_key_exists($key, $this->remembered)) {
            $this->remembered[$key] = $compute();
        }

        return $this->remembered[$key];
    }

    /** Forgets one remembered read, or all of them when `$key` is null. */
    public function forget(?string $key = null): void
    {
        if ($key === null) {
            $this->remembered = [];
        } else {
            unset($this->remembered[$key]);
        }
    }

    public function uses(string $capability): bool
    {
        return in_array($capability, $this->using, true);
    }
}
