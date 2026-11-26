<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\StoragePaths;

/**
 * Tells the FileNode index that a share on a path changed (created, updated, revoked, moved, or
 * one of its grants added or removed): the node takes a new change_seq, so FileNode/changes
 * reports it and the client refetches its `shareFlags` (#2063).
 */
final class DriveShareChangeRecorder
{
    public function __construct(
        private FileNodeIndexService $fileNodes,
        private StoragePaths $paths,
    ) {}

    public function record(string $virtualPath): void
    {
        $this->fileNodes->recordShareChange($this->paths->virtualToStorageKey($virtualPath));
    }
}
