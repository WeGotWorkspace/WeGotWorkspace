<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Models\JmapContentHashJob;
use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\Download\DownloadTicketService;
use App\Services\Jmap\FileNodes\FileNodeBlobAttacher;
use App\Services\Jmap\FileNodes\FileNodeHashJobRunner;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;

/**
 * Cleanup that does not assume a scheduler (#1500). `wgw:jmap:blobs-gc`
 * (not in the schedule) runs it in full, with hashing capped in time (#1873);
 * besides that, a small share of /jmap/upload and Blob/upload requests run
 * one bounded round:
 *
 *  - expired assemblies (their file and part claims; finished ones only
 *    their row) — first, so their parts become ordinary expired blobs,
 *  - expired blobs, honouring every reference checker,
 *  - staged attach copies nobody resumed, orphaned temp files, and
 *    expired download tickets,
 *  - one slice of pending content hashes of files discovered on disk.
 */
final class JmapBlobMaintenance
{
    private const BLOBS_PER_ROUND = 100;

    private const ASSEMBLIES_PER_ROUND = 25;

    private const TEMP_FILES_PER_ROUND = 50;

    /** Opportunistic hashing takes a small slice of the request's budget. */
    private const HASH_SHARE_OF_BUDGET = 8;

    public function __construct(
        private readonly JmapBlobGarbageCollector $collector,
        private readonly BlobAssemblyService $assemblies,
        private readonly FileNodeBlobAttacher $attacher,
        private readonly FileNodeHashJobRunner $hashJobs,
        private readonly DownloadTicketService $tickets,
        private readonly WgwStorage $storage,
    ) {}

    /**
     * Runs one bounded round on WGW_JMAP_MAINTENANCE_SHARE of calls. Never
     * fails the request that carries it.
     */
    public function maybeRun(): void
    {
        $share = (float) config('wgw.jmap.maintenance_share', 0.05);
        if ($share <= 0 || (mt_rand() / mt_getrandmax()) >= $share) {
            return;
        }
        try {
            $this->runBounded();
        } catch (\Throwable $e) {
            report($e);
        }
    }

    /**
     * @return array{assembliesExpired: int, blobsDeleted: int, blobsRetained: int, stagingExpired: int, tempFilesDeleted: int, hashesStored: int, hashesPending: int}
     */
    public function runBounded(): array
    {
        $hashBudget = intdiv(JmapBlobLimits::stepBudgetBytes(), self::HASH_SHARE_OF_BUDGET);

        return $this->run(
            self::ASSEMBLIES_PER_ROUND,
            self::BLOBS_PER_ROUND,
            self::TEMP_FILES_PER_ROUND,
            $hashBudget,
            0,
        );
    }

    /**
     * Every expired item at once, for the console command. Pending hashes
     * get step after step until none is left, a step moves nothing on, or
     * `$maxSeconds` (default: one step time limit, 60 s on the CLI) has
     * passed; the rest waits for the next run (#1873). A run can overshoot
     * by at most the step that was under way.
     *
     * @return array{assembliesExpired: int, blobsDeleted: int, blobsRetained: int, stagingExpired: int, tempFilesDeleted: int, hashesStored: int, hashesPending: int}
     */
    public function runFull(?int $maxSeconds = null): array
    {
        $maxSeconds = max(0, $maxSeconds ?? JmapBlobLimits::timeLimitSeconds());

        return $this->run(PHP_INT_MAX, null, PHP_INT_MAX, JmapBlobLimits::stepBudgetBytes(), $maxSeconds);
    }

    /**
     * @param  int  $stepBudget  bytes to hash per step
     * @param  int  $hashSeconds  keep taking steps for this long (0: one step)
     * @return array{assembliesExpired: int, blobsDeleted: int, blobsRetained: int, stagingExpired: int, tempFilesDeleted: int, hashesStored: int, hashesPending: int}
     */
    private function run(int $assemblyLimit, ?int $blobLimit, int $tempLimit, int $stepBudget, int $hashSeconds): array
    {
        $assemblies = $this->assemblies->expire($assemblyLimit);
        $blobs = $this->collector->collect(limit: $blobLimit);
        $staging = $this->attacher->expireStaging($tempLimit);
        $temp = $this->sweepTempFiles($tempLimit);
        $this->tickets->pruneExpired();
        $hashed = $this->hashPending($stepBudget, $hashSeconds);

        return [
            'assembliesExpired' => $assemblies,
            'blobsDeleted' => $blobs['deleted'],
            'blobsRetained' => $blobs['retained'],
            'stagingExpired' => $staging,
            'tempFilesDeleted' => $temp,
            'hashesStored' => $hashed,
            'hashesPending' => JmapContentHashJob::query()->count(),
        ];
    }

    private function hashPending(int $stepBudget, int $seconds): int
    {
        $deadline = hrtime(true) + $seconds * 1_000_000_000;
        $hashed = 0;
        do {
            $round = $this->hashJobs->advance($stepBudget);
            $hashed += $round['hashed'];
        } while ($round['advanced'] > 0 && hrtime(true) < $deadline);

        return $hashed;
    }

    /**
     * Temp files a killed request left behind (a part or a join that never
     * committed), older than one blob TTL.
     */
    private function sweepTempFiles(int $limit): int
    {
        $disk = $this->storage->data();
        if (! $disk->directoryExists('jmap/tmp')) {
            return 0;
        }
        $cutoff = Carbon::now()->subHours(JmapBlobLimits::blobTtlHours())->getTimestamp();
        $deleted = 0;
        foreach ($disk->allFiles('jmap/tmp') as $key) {
            if ($deleted >= $limit) {
                break;
            }
            try {
                if ($disk->lastModified($key) < $cutoff) {
                    $disk->delete($key);
                    $deleted++;
                }
            } catch (\Throwable) {
                // Raced with its own request; skip.
            }
        }

        return $deleted;
    }
}
