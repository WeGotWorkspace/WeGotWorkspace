<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeRootMarkers;
use App\Services\Jmap\FileNodes\FileNodeSequence;
use App\Storage\StoragePaths;

/**
 * Tells the FileNode index that a share on a path changed (created, updated, revoked, moved, or
 * one of its grants added or removed): the node takes the next change_seq and its Drive root is
 * pushed, so FileNode/changes reports it and the client refetches its `shareFlags` (#2063).
 * Nothing on disk changed; a path without a live node is a no-op.
 */
final class DriveShareChangeRecorder
{
    public function __construct(
        private FileNodeIndexService $fileNodes,
        private FileNodeSequence $seq,
        private FileNodeRootMarkers $markers,
        private StoragePaths $paths,
    ) {}

    public function record(string $virtualPath): void
    {
        $key = $this->paths->virtualToStorageKey($virtualPath);
        $this->markers->batch(function () use ($key): void {
            $node = $this->fileNodes->liveByKey($key);
            if ($node === null) {
                return;
            }
            $node->change_seq = $this->seq->next();
            $node->save();
            $this->markers->touch($key);
        });
    }
}
