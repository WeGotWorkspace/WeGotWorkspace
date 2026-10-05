<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Exclusive flock on a sibling path. Shared hosting has no cross-process cache lock.
 */
final class ExclusiveFileLock
{
    /**
     * @return resource
     */
    public static function acquire(string $path)
    {
        $directory = dirname($path);
        if (! is_dir($directory) && ! mkdir($directory, 0775, true) && ! is_dir($directory)) {
            throw new \RuntimeException('lock_unavailable');
        }

        $handle = fopen($path, 'c');
        if ($handle === false) {
            throw new \RuntimeException('lock_unavailable');
        }
        @chmod($path, 0660);
        if (! flock($handle, LOCK_EX)) {
            fclose($handle);
            throw new \RuntimeException('lock_unavailable');
        }

        return $handle;
    }

    /**
     * @param  resource  $handle
     */
    public static function release($handle): void
    {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
