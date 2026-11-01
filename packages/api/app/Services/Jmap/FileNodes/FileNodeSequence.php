<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNodeMeta;
use Illuminate\Support\Facades\DB;

/**
 * The global monotonic FileNode change sequence (#450) and its pruning
 * horizon: every index write takes the next value as the row's
 * change_seq, and FileNode/changes answers cannotCalculateChanges for a
 * sinceState below the horizon.
 */
final class FileNodeSequence
{
    public function current(): int
    {
        return (int) ($this->meta()->seq ?? 0);
    }

    public function pruned(): int
    {
        return (int) ($this->meta()->pruned_seq ?? 0);
    }

    public function next(): int
    {
        return DB::connection('wgw')->transaction(function (): int {
            $meta = JmapFileNodeMeta::query()->lockForUpdate()->first();
            if ($meta === null) {
                $meta = JmapFileNodeMeta::query()->create(['seq' => 0, 'pruned_seq' => 0]);
            }
            $meta->seq = (int) $meta->seq + 1;
            $meta->save();

            return (int) $meta->seq;
        });
    }

    /**
     * Moves the pruning horizon up to the highest change_seq of the pruned
     * tombstones; it never moves down.
     */
    public function raisePruned(int $maxSeq): void
    {
        $meta = $this->meta();
        if ($maxSeq > (int) $meta->pruned_seq) {
            $meta->pruned_seq = $maxSeq;
            $meta->save();
        }
    }

    private function meta(): JmapFileNodeMeta
    {
        return JmapFileNodeMeta::query()->first()
            ?? JmapFileNodeMeta::query()->create(['seq' => 0, 'pruned_seq' => 0]);
    }
}
