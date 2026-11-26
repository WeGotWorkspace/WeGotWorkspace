<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Models\JmapFileNodeDeparture;
use Closure;
use Illuminate\Support\Carbon;

/**
 * Keys that moved nodes left (#2036). A move keeps the node id and only
 * rewrites the storage key, so without this record FileNode/changes cannot
 * tell that a node left the caller's sight, for example a Team Doc moved to
 * its owner's personal Trash. RFC 8620 §5.2 wants such a node in `destroyed`.
 */
final class FileNodeDepartures
{
    /**
     * One row per moved node, all at the seq of the move.
     *
     * @param  list<array{node_id: string, from_key: string}>  $moved
     */
    public function record(array $moved, int $seq): void
    {
        $now = now();
        $rows = array_map(
            static fn (array $node): array => [...$node, 'seq' => $seq, 'created_at' => $now],
            $moved,
        );
        foreach (array_chunk($rows, 500) as $chunk) {
            JmapFileNodeDeparture::query()->insert($chunk);
        }
    }

    /**
     * Nodes that moved across the edge of the caller's sight since $since, from one read of
     * the departures table. The first departure after $since holds the key the node had at
     * $since; a move records every moved descendant, so a moved folder's subtree is here too.
     *
     * - `destroyed` (#2036): visible at $since, out of sight now. A node created after $since
     *   is left out, like in the main changes loop. A node that is gone now but still visible
     *   stays with the main loop, which reports its tombstone.
     * - `arrived` (#2063): out of sight at $since, live and visible now, and created at or
     *   before $since. `recordMove` bumps only the moved node, so without this a folder dragged
     *   from someone's home into a Team drive reaches the other members without its children.
     *   A node created after $since is in the main loop's `created` already.
     *
     * @param  Closure(string): bool  $isVisible
     * @return array{destroyed: list<string>, arrived: list<string>}
     */
    public function movedSince(int $since, Closure $isVisible): array
    {
        $keyAtSince = [];
        $rows = JmapFileNodeDeparture::query()
            ->where('seq', '>', $since)
            ->orderBy('seq')
            ->orderBy('id')
            ->get(['node_id', 'from_key']);
        foreach ($rows as $row) {
            $keyAtSince[(string) $row->node_id] ??= (string) $row->from_key;
        }

        $destroyed = [];
        $arrived = [];
        foreach (array_chunk(array_keys($keyAtSince), 500) as $chunk) {
            $chunk = array_map('strval', $chunk);
            $current = JmapFileNode::query()->whereIn('node_id', $chunk)
                ->get(['node_id', 'storage_key', 'created_seq', 'deleted_at'])->keyBy('node_id');
            foreach ($chunk as $nodeId) {
                $wasVisible = $isVisible($keyAtSince[$nodeId]);
                $node = $current->get($nodeId);
                if ($node === null) {
                    // The row itself is gone: the caller cannot see it either.
                    if ($wasVisible) {
                        $destroyed[] = $nodeId;
                    }

                    continue;
                }
                if ((int) $node->created_seq > $since) {
                    continue;
                }
                $isVisibleNow = $isVisible((string) $node->storage_key);
                if ($wasVisible && ! $isVisibleNow) {
                    $destroyed[] = $nodeId;
                } elseif (! $wasVisible && $isVisibleNow && $node->deleted_at === null) {
                    $arrived[] = $nodeId;
                }
            }
        }

        return ['destroyed' => $destroyed, 'arrived' => $arrived];
    }

    /**
     * Deletes departures older than $cutoff. Returns the highest pruned seq
     * (0 when none), so the caller can raise the pruning horizon.
     */
    public function pruneBefore(Carbon $cutoff): int
    {
        $stale = JmapFileNodeDeparture::query()->where('created_at', '<', $cutoff);
        $maxSeq = (int) (clone $stale)->max('seq');
        if ($maxSeq > 0) {
            $stale->delete();
        }

        return $maxSeq;
    }
}
