<?php

declare(strict_types=1);

namespace App\Services\Update;

/**
 * One process at a time runs wgw migrations: the in-app updater, or the
 * first request after an update that left migrations pending (#1076).
 *
 * The lock is an flock on a file in the data directory, so the OS releases
 * it when the holder exits, even after a fatal error or a kill.
 */
final class SchemaMigrationLock
{
    public const PATH = 'updates/schema-migrations.lock';

    private const POLL_MICROSECONDS = 100_000;

    public function __construct(private UpdateStateStore $updates) {}

    /**
     * @return resource|null The held lock, or null while another process holds it.
     *
     * @throws \RuntimeException When the lock file cannot be created.
     */
    public function tryAcquire()
    {
        $path = $this->updates->absolutePath(self::PATH);
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException('Could not create '.$dir.'.');
        }
        $handle = @fopen($path, 'c');
        if (! is_resource($handle)) {
            throw new \RuntimeException('Could not open '.$path.'.');
        }
        if (! flock($handle, LOCK_EX | LOCK_NB)) {
            fclose($handle);

            return null;
        }

        return $handle;
    }

    /**
     * Polls every 100 ms.
     *
     * @return resource|null The held lock, or null when it stayed busy for $seconds.
     */
    public function acquireWithin(float $seconds)
    {
        $deadline = microtime(true) + $seconds;
        while (true) {
            $handle = $this->tryAcquire();
            if ($handle !== null || microtime(true) >= $deadline) {
                return $handle;
            }
            usleep(self::POLL_MICROSECONDS);
        }
    }

    /**
     * Runs $work under the lock, waiting up to $seconds for it.
     *
     * @param  callable(): void  $work
     * @return bool False when the lock stayed busy and $work did not run.
     */
    public function runExclusive(callable $work, float $seconds): bool
    {
        $handle = $this->acquireWithin($seconds);
        if ($handle === null) {
            return false;
        }
        try {
            $work();
        } finally {
            $this->release($handle);
        }

        return true;
    }

    /**
     * @param  resource  $handle
     */
    public function release($handle): void
    {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
