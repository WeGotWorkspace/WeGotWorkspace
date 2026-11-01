<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * A write failed because the disk or the account's hosting quota is full
 * (ENOSPC / EDQUOT). Answered as 507 with a JMAP problem body on the blob
 * endpoints and as the overQuota SetError in FileNode/set — never a 500 the
 * client would retry forever.
 */
final class StorageFullException extends \RuntimeException
{
    private const PATTERNS = [
        'no space left',
        'disk quota exceeded',
        'quota exceeded',
        'not enough space',
        'enospc',
        'edquot',
        'file too large',
    ];

    public static function matches(?string $message): bool
    {
        if ($message === null || $message === '') {
            return false;
        }
        $lower = strtolower($message);
        foreach (self::PATTERNS as $pattern) {
            if (str_contains($lower, $pattern)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The storage-full exception for PHP's last error, or null when the
     * last error was something else.
     */
    public static function fromLastError(string $operation): ?self
    {
        $last = error_get_last();
        $message = is_array($last) ? (string) $last['message'] : '';

        return self::matches($message) ? new self('The storage is full ('.$operation.').') : null;
    }

    /**
     * Wraps a Flysystem / PHP failure when it was caused by a full disk.
     */
    public static function fromThrowable(\Throwable $e): ?self
    {
        if ($e instanceof self) {
            return $e;
        }
        for ($current = $e; $current !== null; $current = $current->getPrevious()) {
            if (self::matches($current->getMessage())) {
                return new self('The storage is full.', 0, $e);
            }
        }

        return self::fromLastError('write');
    }
}
