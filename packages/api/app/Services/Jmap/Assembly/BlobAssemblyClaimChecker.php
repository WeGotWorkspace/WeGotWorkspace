<?php

declare(strict_types=1);

namespace App\Services\Jmap\Assembly;

use App\Services\Jmap\Blobs\JmapBlobReferenceCheckerInterface;

/**
 * Reference checker for assemblies in progress: a part an open assembly has
 * claimed is never deleted, neither by the GC nor by another assembly that
 * consumed the same bytes.
 */
final class BlobAssemblyClaimChecker implements JmapBlobReferenceCheckerInterface
{
    public function __construct(private readonly BlobClaimService $claims) {}

    public function isReferenced(string $username, string $blobId): bool
    {
        return $this->claims->isClaimed($username, $blobId);
    }
}
