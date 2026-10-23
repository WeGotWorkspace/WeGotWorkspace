<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Storage\Local\LocalDiskFiles;
use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * disk_free_space() of a local disk's root. On shared hosting this often
 * reports the whole disk rather than the account's hosting quota; a write
 * the host refuses anyway still ends as StorageFullException.
 */
final class DiskFreeSpaceSource implements FreeSpaceSource
{
    public function __construct(private readonly LocalDiskFiles $local) {}

    public function freeBytes(Filesystem $disk): ?int
    {
        if (! $this->local->isLocal($disk)) {
            return null;
        }
        $root = $this->local->absolutePath($disk, '');
        if (! is_dir($root)) {
            return null;
        }
        $free = @disk_free_space($root);

        return $free === false ? null : (int) $free;
    }
}
