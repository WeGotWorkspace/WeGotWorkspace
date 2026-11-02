<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapContentHashJob;
use App\Models\JmapFileNode;
use App\Services\Jmap\Assembly\StepHasher;
use App\Services\Jmap\Blobs\HashStateCodec;
use App\Services\Jmap\Blobs\JmapBlobLimits;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;

/**
 * Advances the hashes of hash-pending files in budgeted steps with the same
 * resumable HashContext machinery as assembly (#1500): opportunistically
 * (JmapBlobMaintenance) and via `wgw:jmap:blobs-gc` when cron exists. A
 * file whose size or mtime changed since its job started is hashed again
 * from byte 0. No call reads more than its budget.
 */
final class FileNodeHashJobRunner
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly FileNodeContentClaims $claims,
        private readonly FileNodeContentHasher $hasher,
    ) {}

    /**
     * @return array{hashed: int, advanced: int}
     */
    public function advance(?int $budget = null): array
    {
        $budget ??= JmapBlobLimits::stepBudgetBytes();
        $hashed = 0;
        $advanced = 0;
        $now = Carbon::now();
        $jobs = JmapContentHashJob::query()
            ->where(function ($query) use ($now): void {
                $query->whereNull('locked_until')->orWhere('locked_until', '<', $now);
            })
            ->orderBy('updated_at')
            ->orderBy('id')
            ->limit(25)
            ->get();

        foreach ($jobs as $job) {
            if ($budget <= 0) {
                break;
            }
            if (! $this->lease($job)) {
                continue;
            }
            try {
                [$spent, $done] = $this->step($job, $budget);
            } finally {
                JmapContentHashJob::query()->where('id', $job->id)->update(['locked_until' => null]);
            }
            $budget -= $spent;
            $advanced++;
            if ($done) {
                $hashed++;
            }
        }

        return ['hashed' => $hashed, 'advanced' => $advanced];
    }

    /**
     * @return array{0: int, 1: bool} bytes read, job finished
     */
    private function step(JmapContentHashJob $job, int $budget): array
    {
        $node = JmapFileNode::query()->where('node_id', $job->node_id)->whereNull('deleted_at')->first();
        if ($node === null || ! $node->hash_pending || $node->is_dir) {
            $job->delete();

            return [0, false];
        }
        $key = (string) $node->storage_key;
        $basis = $this->hasher->basis($key);
        if ($basis === null) {
            // Vanished out of band; the next reconcile tombstones the node.
            return [0, false];
        }
        [$size] = array_map(intval(...), explode(':', $basis));

        [$context, $hashed] = StepHasher::resume($job->hash_state, $job->hash_build, $job->hashed_bytes);
        if ($basis !== $job->basis || $hashed > $size) {
            // Rewritten since the job started: hash it again from 0.
            [$context, $hashed] = [hash_init('sha256'), 0];
            $job->basis = $basis;
        }
        $offset = StepHasher::advance($this->storage->files(), $key, $context, $hashed, $size, $budget);
        $spent = $offset - $hashed;

        if ($offset >= $size) {
            if ($this->hasher->basis($key) !== $basis) {
                $this->restart($job, $basis);

                return [$spent, false];
            }
            $this->claims->recordHashResolved($node, hash_final($context), $size);

            return [$spent, true];
        }

        $encoded = HashStateCodec::encode($context);
        $job->hashed_bytes = $offset;
        $job->hash_state = $encoded['state'];
        $job->hash_build = $encoded['build'];
        $job->save();

        return [$spent, false];
    }

    private function restart(JmapContentHashJob $job, string $basis): void
    {
        $encoded = HashStateCodec::encode(hash_init('sha256'));
        $job->basis = $basis;
        $job->hashed_bytes = 0;
        $job->hash_state = $encoded['state'];
        $job->hash_build = $encoded['build'];
        $job->save();
    }

    private function lease(JmapContentHashJob $job): bool
    {
        $now = Carbon::now();

        return JmapContentHashJob::query()
            ->where('id', $job->id)
            ->where(function ($query) use ($now): void {
                $query->whereNull('locked_until')->orWhere('locked_until', '<', $now);
            })
            ->update(['locked_until' => $now->copy()->addSeconds(JmapBlobLimits::timeLimitSeconds() + 5)]) === 1;
    }
}
