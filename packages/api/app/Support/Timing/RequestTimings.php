<?php

declare(strict_types=1);

namespace App\Support\Timing;

/**
 * Where one request spent its time (#2244): database queries and commits,
 * storage operations, and each JMAP method. One instance per request (PHP-FPM
 * boots a fresh app per request); LogSlowRequest writes it out when the
 * request was slow.
 *
 * Only durations, counts and registered JMAP method names go in here: never
 * arguments, ids, paths or other content of the request.
 */
final class RequestTimings
{
    private float $startedAt;

    private int $dbNs = 0;

    private int $dbQueries = 0;

    private int $commitNs = 0;

    /** @var array<string, int|float> hrtime when each connection began its commit */
    private array $committing = [];

    private int $storageNs = 0;

    private int $storageOps = 0;

    /** @var list<array{name: string, ms: int, db_ms: int, storage_ms: int}> */
    private array $methods = [];

    public function __construct(?float $startedAt = null)
    {
        $this->startedAt = $startedAt ?? self::requestStart();
    }

    public function addQuery(float $milliseconds): void
    {
        $this->dbQueries++;
        $this->dbNs += (int) round($milliseconds * 1_000_000);
    }

    /** COMMIT is not a query event, and it is where Galera certifies the writes. */
    public function commitStarting(string $connection): void
    {
        $this->committing[$connection] = hrtime(true);
    }

    public function commitFinished(string $connection): void
    {
        $started = $this->committing[$connection] ?? null;
        unset($this->committing[$connection]);
        if ($started !== null) {
            $this->commitNs += (int) (hrtime(true) - $started);
        }
    }

    public function addStorage(int|float $nanoseconds): void
    {
        $this->storageOps++;
        $this->storageNs += max(0, (int) $nanoseconds);
    }

    /**
     * @template T
     *
     * @param  callable(): T  $operation
     * @return T
     */
    public function storage(callable $operation): mixed
    {
        $started = hrtime(true);
        try {
            return $operation();
        } finally {
            $this->addStorage(hrtime(true) - $started);
        }
    }

    /**
     * Runs one JMAP method and records its time under its registered name.
     *
     * @template T
     *
     * @param  callable(): T  $run
     * @return T
     */
    public function method(string $name, callable $run): mixed
    {
        $started = hrtime(true);
        $db = $this->dbNs + $this->commitNs;
        $storage = $this->storageNs;
        try {
            return $run();
        } finally {
            $this->methods[] = [
                'name' => $name,
                'ms' => self::ms(hrtime(true) - $started),
                'db_ms' => self::ms($this->dbNs + $this->commitNs - $db),
                'storage_ms' => self::ms($this->storageNs - $storage),
            ];
        }
    }

    public function elapsedMs(): int
    {
        return max(0, (int) round((microtime(true) - $this->startedAt) * 1000));
    }

    /**
     * @return array{ms: int, db_ms: int, db_queries: int, db_commit_ms: int, storage_ms: int, storage_ops: int, other_ms: int, methods: list<array{name: string, ms: int, db_ms: int, storage_ms: int}>}
     */
    public function summary(): array
    {
        $ms = $this->elapsedMs();
        $db = self::ms($this->dbNs + $this->commitNs);
        $storage = self::ms($this->storageNs);

        return [
            'ms' => $ms,
            'db_ms' => $db,
            'db_queries' => $this->dbQueries,
            'db_commit_ms' => self::ms($this->commitNs),
            'storage_ms' => $storage,
            'storage_ops' => $this->storageOps,
            'other_ms' => max(0, $ms - $db - $storage),
            'methods' => $this->methods,
        ];
    }

    private static function requestStart(): float
    {
        $start = $_SERVER['REQUEST_TIME_FLOAT'] ?? null;

        return is_float($start) || is_int($start) ? (float) $start : microtime(true);
    }

    private static function ms(int $nanoseconds): int
    {
        return (int) round($nanoseconds / 1_000_000);
    }
}
