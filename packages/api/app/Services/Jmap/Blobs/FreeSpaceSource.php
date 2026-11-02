<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * Free space for a disk, behind one interface so a configured soft limit
 * can replace disk_free_space() later without changing the client (#1499
 * follow-up idea). null = unknown.
 */
interface FreeSpaceSource
{
    public function freeBytes(Filesystem $disk): ?int;
}
