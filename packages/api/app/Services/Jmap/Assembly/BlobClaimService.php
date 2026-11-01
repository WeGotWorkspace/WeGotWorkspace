<?php

declare(strict_types=1);

namespace App\Services\Jmap\Assembly;

use App\Models\JmapBlobAssembly;
use App\Models\JmapBlobClaim;

/**
 * Part claims (#1500): a part uploaded with `Wgw-Assembly-Id` is claimed by
 * that open assembly, so another assembly that consumes the same
 * content-addressed part does not delete it while this one still needs it.
 */
final class BlobClaimService
{
    public function claim(string $username, string $assemblyId, string $blobId): void
    {
        $open = JmapBlobAssembly::query()
            ->where('assembly_id', $assemblyId)
            ->where('username', $username)
            ->where('status', BlobAssemblyService::STATUS_OPEN)
            ->exists();
        if (! $open) {
            // An unknown or foreign id is ignored: the claim is a hint for
            // cleanup, never a reason to refuse an upload.
            return;
        }
        JmapBlobClaim::query()->firstOrCreate(
            ['assembly_id' => $assemblyId, 'blob_id' => $blobId],
            ['username' => $username],
        );
    }

    /**
     * Whether an open assembly other than $exceptAssemblyId claims the blob.
     */
    public function isClaimed(string $username, string $blobId, ?string $exceptAssemblyId = null): bool
    {
        $query = JmapBlobClaim::query()
            ->where('jmap_blob_claims.username', $username)
            ->where('jmap_blob_claims.blob_id', $blobId)
            ->join('jmap_blob_assemblies', 'jmap_blob_assemblies.assembly_id', '=', 'jmap_blob_claims.assembly_id')
            ->where('jmap_blob_assemblies.status', BlobAssemblyService::STATUS_OPEN);
        if ($exceptAssemblyId !== null) {
            $query->where('jmap_blob_claims.assembly_id', '!=', $exceptAssemblyId);
        }

        return $query->exists();
    }

    /**
     * @param  list<string>  $blobIds
     */
    public function release(string $assemblyId, ?array $blobIds = null): void
    {
        $query = JmapBlobClaim::query()->where('assembly_id', $assemblyId);
        if ($blobIds !== null) {
            $query->whereIn('blob_id', $blobIds);
        }
        $query->delete();
    }
}
