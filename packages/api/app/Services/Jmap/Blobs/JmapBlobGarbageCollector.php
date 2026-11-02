<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Models\JmapBlob;
use App\Services\Jmap\Assembly\BlobAssemblyClaimChecker;
use App\Services\Jmap\FileNodes\FileNodeAttachChecker;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Deletes expired, unreferenced envelope blobs. Reference checks are
 * domain-owned: every registered JmapBlobReferenceCheckerInterface gets a
 * veto per blob (assemblies in progress through their part claims, and
 * FileNode attaches that still stream a copy of the blob — #1500).
 */
final class JmapBlobGarbageCollector
{
    /**
     * Domain reference-checker classes; envelope domains that hold
     * blob references append theirs here (mail drafts next). Resolved by the
     * container binding in WgwServiceProvider.
     *
     * @var list<class-string<JmapBlobReferenceCheckerInterface>>
     */
    public const CHECKERS = [
        BlobAssemblyClaimChecker::class,
        FileNodeAttachChecker::class,
    ];

    public function __construct(
        private readonly JmapBlobService $blobs,
        private readonly JmapBlobReferenceGuard $references,
    ) {}

    /**
     * @return array{deleted: int, retained: int}
     */
    public function collect(?Carbon $now = null, ?int $limit = null): array
    {
        $now ??= Carbon::now();
        $deleted = 0;
        $retained = 0;

        $query = JmapBlob::query()
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', $now)
            ->orderBy('id');
        if ($limit !== null) {
            $query->limit($limit);
        }

        foreach ($query->get(['username', 'blob_id']) as $row) {
            $username = (string) $row->username;
            $blobId = (string) $row->blob_id;
            if ($this->references->isReferenced($username, $blobId)) {
                $retained++;

                continue;
            }
            if ($this->deleteIfStillExpired($username, $blobId, $now)) {
                $deleted++;
            } else {
                $retained++;
            }
        }

        return ['deleted' => $deleted, 'retained' => $retained];
    }

    /**
     * Re-checks the expiry under the row's lock right before deleting: a
     * re-upload of the same bytes may have renewed the blob since it was
     * listed, and it then waits for this lock (JmapBlobService::commitFile
     * writes the row before it looks at the bytes).
     */
    private function deleteIfStillExpired(string $username, string $blobId, Carbon $now): bool
    {
        return DB::connection('wgw')->transaction(function () use ($username, $blobId, $now): bool {
            $locked = JmapBlob::query()
                ->where('username', $username)
                ->where('blob_id', $blobId)
                ->lockForUpdate()
                ->first();
            if ($locked === null || $locked->expires_at === null || ! $locked->expires_at->lt($now)) {
                return false;
            }
            $this->blobs->delete($username, $blobId);

            return true;
        });
    }
}
