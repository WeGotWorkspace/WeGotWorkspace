<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Services\Jmap\Assembly\BlobAssemblyService;

/**
 * Cleanup that does not assume a scheduler (#1500): besides
 * `wgw:jmap:blobs-gc`, a small share of /jmap/upload and Blob/upload
 * requests run one bounded round — expired blobs (reference checkers
 * honoured) and expired assemblies.
 */
final class JmapBlobMaintenance
{
    private const BLOBS_PER_ROUND = 100;

    private const ASSEMBLIES_PER_ROUND = 25;

    public function __construct(
        private readonly JmapBlobGarbageCollector $collector,
        private readonly BlobAssemblyService $assemblies,
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
     * @return array{blobsDeleted: int, blobsRetained: int, assembliesExpired: int}
     */
    public function runBounded(?int $blobLimit = self::BLOBS_PER_ROUND, ?int $assemblyLimit = self::ASSEMBLIES_PER_ROUND): array
    {
        // Assemblies first: an expired assembly releases its part claims,
        // so its parts are ordinary expired blobs for the GC below.
        $assemblies = $this->assemblies->expire($assemblyLimit ?? PHP_INT_MAX);
        $blobs = $this->collector->collect(limit: $blobLimit);

        return [
            'blobsDeleted' => $blobs['deleted'],
            'blobsRetained' => $blobs['retained'],
            'assembliesExpired' => $assemblies,
        ];
    }
}
