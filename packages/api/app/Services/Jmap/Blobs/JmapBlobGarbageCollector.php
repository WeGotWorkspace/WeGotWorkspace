<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Models\JmapBlob;
use Illuminate\Support\Carbon;

/**
 * Deletes expired, unreferenced envelope blobs. Reference checks are
 * domain-owned (spec constraint: reference protection from day one, so the
 * filenode chunk doesn't retrofit GC): every registered
 * JmapBlobReferenceCheckerInterface gets a veto per blob.
 */
final class JmapBlobGarbageCollector
{
    /**
     * Domain reference-checker classes; future envelope domains that hold
     * long-lived blob references (filenode, mail drafts) append theirs here.
     * Resolved by the container binding in WgwServiceProvider.
     *
     * @var list<class-string<JmapBlobReferenceCheckerInterface>>
     */
    public const CHECKERS = [];

    /** @var list<JmapBlobReferenceCheckerInterface> */
    private array $checkers;

    /**
     * @param  list<JmapBlobReferenceCheckerInterface>  $checkers
     */
    public function __construct(
        private readonly JmapBlobService $blobs,
        array $checkers,
    ) {
        $this->checkers = $checkers;
    }

    /**
     * @return array{deleted: int, retained: int}
     */
    public function collect(?Carbon $now = null): array
    {
        $now ??= Carbon::now();
        $deleted = 0;
        $retained = 0;

        $expired = JmapBlob::query()
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', $now)
            ->orderBy('id')
            ->get(['username', 'blob_id']);

        foreach ($expired as $row) {
            $username = (string) $row->username;
            $blobId = (string) $row->blob_id;
            if ($this->isReferenced($username, $blobId)) {
                $retained++;

                continue;
            }
            $this->blobs->delete($username, $blobId);
            $deleted++;
        }

        return ['deleted' => $deleted, 'retained' => $retained];
    }

    private function isReferenced(string $username, string $blobId): bool
    {
        foreach ($this->checkers as $checker) {
            if ($checker->isReferenced($username, $blobId)) {
                return true;
            }
        }

        return false;
    }
}
