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
     * Ids of nodes that were visible at $since and are out of sight now. A
     * node created after $since is left out, like in the main changes loop.
     * A node that is gone now but still visible stays with the main loop,
     * which reports its tombstone.
     *
     * @param  Closure(string): bool  $isVisible
     * @return list<string>
     */
    public function destroyedSince(int $since, Closure $isVisible): array
    {
        // The first departure after $since holds the key the node had at $since.
        $keyAtSince = [];
        $rows = JmapFileNodeDeparture::query()
            ->where('seq', '>', $since)
            ->orderBy('seq')
            ->orderBy('id')
            ->get(['node_id', 'from_key']);
        foreach ($rows as $row) {
            $keyAtSince[(string) $row->node_id] ??= (string) $row->from_key;
        }

        $wasVisible = [];
        foreach ($keyAtSince as $nodeId => $key) {
            if ($isVisible($key)) {
                $wasVisible[] = (string) $nodeId;
            }
        }

        $destroyed = [];
        foreach (array_chunk($wasVisible, 500) as $chunk) {
            $current = JmapFileNode::query()->whereIn('node_id', $chunk)->get()->keyBy('node_id');
            foreach ($chunk as $nodeId) {
                $node = $current->get($nodeId);
                if ($node === null) {
                    // The row itself is gone: the caller cannot see it either.
                    $destroyed[] = $nodeId;
                } elseif ((int) $node->created_seq <= $since && ! $isVisible((string) $node->storage_key)) {
                    $destroyed[] = $nodeId;
                }
            }
        }

        return $destroyed;
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
