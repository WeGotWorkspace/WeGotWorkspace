<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\FileNodes\FileNodeBlobAttacher;
use App\Services\Jmap\FileNodes\FileNodeHashJobRunner;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;

/**
 * Cleanup that does not assume a scheduler (#1500). `wgw:jmap:blobs-gc`
 * (not in the schedule) runs it in full; besides that, a small share of
 * /jmap/upload and Blob/upload requests run one bounded round:
 *
 *  - expired assemblies (their file and part claims; finished ones only
 *    their row) — first, so their parts become ordinary expired blobs,
 *  - expired blobs, honouring every reference checker,
 *  - staged attach copies nobody resumed, and orphaned temp files,
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
     * @return array{assembliesExpired: int, blobsDeleted: int, blobsRetained: int, stagingExpired: int, tempFilesDeleted: int, hashesStored: int}
     */
    public function runBounded(): array
    {
        return $this->run(
            self::ASSEMBLIES_PER_ROUND,
            self::BLOBS_PER_ROUND,
            self::TEMP_FILES_PER_ROUND,
            intdiv(JmapBlobLimits::stepBudgetBytes(), self::HASH_SHARE_OF_BUDGET),
        );
    }

    /**
     * Everything at once, for the console command (no request time limit).
     *
     * @return array{assembliesExpired: int, blobsDeleted: int, blobsRetained: int, stagingExpired: int, tempFilesDeleted: int, hashesStored: int}
     */
    public function runFull(int $hashBudgetBytes = PHP_INT_MAX): array
    {
        return $this->run(PHP_INT_MAX, null, PHP_INT_MAX, $hashBudgetBytes);
    }

    /**
     * @return array{assembliesExpired: int, blobsDeleted: int, blobsRetained: int, stagingExpired: int, tempFilesDeleted: int, hashesStored: int}
     */
    private function run(int $assemblyLimit, ?int $blobLimit, int $tempLimit, int $hashBudget): array
    {
        $assemblies = $this->assemblies->expire($assemblyLimit);
        $blobs = $this->collector->collect(limit: $blobLimit);
        $staging = $this->attacher->expireStaging($tempLimit);
        $temp = $this->sweepTempFiles($tempLimit);
        $hashed = 0;
        while ($hashBudget > 0) {
            $budget = min($hashBudget, JmapBlobLimits::stepBudgetBytes());
            $round = $this->hashJobs->advance($budget);
            $hashed += $round['hashed'];
            $hashBudget -= $budget;
            if ($round['advanced'] === 0) {
                break;
            }
        }

        return [
            'assembliesExpired' => $assemblies,
            'blobsDeleted' => $blobs['deleted'],
            'blobsRetained' => $blobs['retained'],
            'stagingExpired' => $staging,
            'tempFilesDeleted' => $temp,
            'hashesStored' => $hashed,
        ];
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
