<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapAttachStaging;
use App\Models\JmapBlob;
use App\Services\Jmap\Blobs\JmapBlobReferenceCheckerInterface;
use Illuminate\Support\Carbon;

/**
 * Reference checker for FileNode blobs (#1500): a blob that a FileNode/set
 * attach is still copying — in this request (in_use_until) or across steps
 * (a staged copy) — is neither collected nor moved away by another attach.
 */
final class FileNodeAttachChecker implements JmapBlobReferenceCheckerInterface
{
    public function isReferenced(string $username, string $blobId): bool
    {
        $inUse = JmapBlob::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->whereNotNull('in_use_until')
            ->where('in_use_until', '>', Carbon::now())
            ->exists();

        return $inUse || JmapAttachStaging::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->exists();
    }
}
