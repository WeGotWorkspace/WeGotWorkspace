<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Storage\WgwStorage;

/**
 * Full-tree backfill and reconcile of the FileNode index (the reindexAll
 * pattern), behind `wgw:jmap:filenodes-reindex` and the search reindex.
 * Existing keys keep their node ids; new keys are minted; vanished keys are
 * tombstoned. The whole walk is one root-marker batch
 * ({@see FileNodeRootMarkers}).
 */
final class FileNodeReindexer
{
    /**
     * How often the optional progress callback runs during the mint walk.
     * Often enough that a caller's phase timestamp stays inside the reindex
     * stale window, without a state write per key.
     */
    private const PROGRESS_STRIDE = 100;

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly WgwStorage $storage,
        private readonly FileNodeRootMarkers $markers,
    ) {}

    /**
     * Also prunes tombstones older than the retention window.
     *
     * `$progress` is `function (int $done, int $total): void`. SearchReindexRunner
     * uses it to refresh the phase and to cancel between batches. A throw
     * aborts the walk.
     *
     * @param  callable(int, int): void|null  $progress
     * @return array{indexed: int, tombstoned: int, pruned: int}
     */
    public function reindexAll(int $tombstoneRetentionDays = 30, ?callable $progress = null): array
    {
        return $this->markers->batch(fn (): array => $this->reindexTree($tombstoneRetentionDays, $progress));
    }

    /**
     * @param  callable(int, int): void|null  $progress
     * @return array{indexed: int, tombstoned: int, pruned: int}
     */
    private function reindexTree(int $tombstoneRetentionDays, ?callable $progress): array
    {
        $disk = $this->storage->files();
        $directoryKeys = $disk->allDirectories();
        $fileKeys = $disk->allFiles();
        $total = count($directoryKeys) + count($fileKeys);
        $indexed = 0;
        $seen = [];
        $done = 0;

        foreach ($directoryKeys as $key) {
            $done++;
            if ($this->index->isIndexableKey($key)) {
                $seen[$key] = true;
                if ($this->index->liveByKey($key) === null && $this->index->recordCreate($key) !== null) {
                    $indexed++;
                }
            }
            $this->reportProgress($progress, $done, $total, $done === count($directoryKeys));
        }
        foreach ($fileKeys as $key) {
            $done++;
            if ($this->index->isIndexableKey($key)) {
                $seen[$key] = true;
                if ($this->index->liveByKey($key) === null && $this->index->recordCreate($key) !== null) {
                    $indexed++;
                }
            }
            $this->reportProgress($progress, $done, $total, $done === $total);
        }

        $tombstoned = 0;
        JmapFileNode::query()->whereNull('deleted_at')->orderBy('id')
            ->chunk(500, function ($rows) use ($seen, $disk, &$tombstoned): void {
                foreach ($rows as $row) {
                    $key = (string) $row->storage_key;
                    if (isset($seen[$key])) {
                        continue;
                    }
                    if ($disk->directoryExists($key) || $disk->fileExists($key)) {
                        continue;
                    }
                    $this->index->recordDelete($key);
                    $tombstoned++;
                }
            });

        $pruned = $this->index->pruneTombstones($tombstoneRetentionDays);

        return ['indexed' => $indexed, 'tombstoned' => $tombstoned, 'pruned' => $pruned];
    }

    /**
     * @param  callable(int, int): void|null  $progress
     */
    private function reportProgress(?callable $progress, int $done, int $total, bool $boundary): void
    {
        if ($progress === null || $total === 0) {
            return;
        }
        if (! $boundary && $done % self::PROGRESS_STRIDE !== 0) {
            return;
        }
        $progress($done, $total);
    }
}
