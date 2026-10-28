<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\JmapFileNode;
use App\Services\Docs\DocsThreadPathSync;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use Illuminate\Support\Facades\Log;

/**
 * Every side effect of a Drive move or delete: node index and Yjs sidecars,
 * doc attachments, stars, share paths and docs threads.
 *
 * Every Drive write surface must call this once the change has landed on
 * disk: REST (DriveService), JMAP FileNode/set (FileNodeRelocator) and
 * WebDAV (FileNodeIndexPlugin). WebDAV writes bypass Laravel models, so no
 * model event can do this for them. Add the next move or delete side effect
 * here, never at a call site.
 *
 * Each step is best-effort: the disk change already happened, so a failure
 * is logged and never fails the request.
 */
final class DrivePathBookkeeping
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly DocAttachmentsService $attachments,
        private readonly DriveStarService $stars,
        private readonly DriveShareService $shares,
        private readonly DocsThreadPathSync $threads,
    ) {}

    /**
     * Storage keys, without a leading slash. Returns the moved index node.
     *
     * A save swap is an editor saving a file by renaming it to or from a
     * temporary name. Share paths and threads then stay on the document's
     * path, or the next step of the save (deleting the temporary file) would
     * drop them.
     */
    public function afterMove(string $fromKey, string $toKey, bool $saveSwap = false): ?JmapFileNode
    {
        $fromKey = trim($fromKey, '/');
        $toKey = trim($toKey, '/');

        $node = $this->attempt(
            'file_node_index_sync_failed',
            fn (): ?JmapFileNode => $this->index->recordMoveWithSidecar($fromKey, $toKey),
        );
        $this->attachments->relocateAfterMoveBestEffort($fromKey, $toKey);
        $this->stars->rewritePathPrefix('/'.$fromKey, '/'.$toKey);
        if ($saveSwap) {
            return $node;
        }
        $this->attempt(
            'drive_share_move_rewrite_failed',
            fn (): int => $this->shares->rewritePathPrefix('/'.$fromKey, '/'.$toKey),
            'error',
        );
        $this->attempt(
            'docs_thread_path_sync_failed',
            fn () => $this->threads->retargetPath('/'.$fromKey, '/'.$toKey),
        );

        return $node;
    }

    /**
     * Storage key, without a leading slash. Reads the index before tombstoning
     * it, so call this after the disk delete and before anything else.
     */
    public function afterDelete(string $key): void
    {
        $key = trim($key, '/');

        $docIds = $this->attempt(
            'doc_attachments_sidecar_failed',
            fn (): array => $this->attachments->docNodeIdsForDestroyKey($key),
        ) ?? [];
        $this->attempt(
            'file_node_index_sync_failed',
            fn () => $this->index->recordDeleteWithSidecar($key),
        );
        $this->attempt(
            'docs_thread_path_sync_failed',
            fn () => $this->threads->dropPath('/'.$key),
        );
        $this->stars->deletePathPrefix('/'.$key);
        $this->attachments->destroyDocsBestEffort($docIds);
    }

    /**
     * @template T
     *
     * @param  callable(): T  $operation
     * @return T|null
     */
    private function attempt(string $event, callable $operation, string $level = 'warning'): mixed
    {
        try {
            return $operation();
        } catch (\Throwable $e) {
            Log::log($level, $event, ['error' => $e->getMessage()]);

            return null;
        }
    }
}
