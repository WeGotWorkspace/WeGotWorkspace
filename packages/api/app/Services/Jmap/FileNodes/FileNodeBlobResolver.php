<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Services\Jmap\Blobs\BlobContent;
use App\Storage\WgwStorage;

/**
 * Resolves node-derived `fnb-{nodeId}-{sha8}` blobIds (design decision 6)
 * for /jmap/download: content streams from the drive, nothing is copied
 * into the blob store and nothing is read into a PHP string (#1500). The
 * sha component must match the node's current content — a stale blobId
 * (content changed since) is a miss, matching draft-14's mutable-blobId
 * semantics. Every call re-runs the caller's `mayRead` check, so a download
 * ticket's next request stops once a share is withdrawn.
 */
final class FileNodeBlobResolver
{
    private const BLOB_ID_PATTERN = '/^fnb-(fn-[0-9a-f]{32})-([0-9a-f]{8})$/';

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeMapper $mapper,
        private readonly FileNodeAccountSupport $accounts,
        private readonly WgwStorage $storage,
    ) {}

    public function retrieve(string $username, string $blobId): ?BlobContent
    {
        if (preg_match(self::BLOB_ID_PATTERN, $blobId, $matches) !== 1) {
            return null;
        }

        $node = $this->index->liveByNodeId($matches[1]);
        if ($node === null || $node->is_dir) {
            return null;
        }

        $principal = $this->accounts->principalFor($username);
        if (! $this->mapper->rightsFor((string) $node->storage_key, $principal)['mayRead']) {
            return null;
        }

        $sha = $this->mapper->ensureContentSha($node);
        if (substr($sha, 0, 8) !== $matches[2]) {
            return null;
        }

        $disk = $this->storage->files();
        $key = (string) $node->storage_key;
        if (! $disk->fileExists($key)) {
            return null;
        }

        $type = null;
        try {
            $type = $disk->mimeType($key) ?: null;
        } catch (\Throwable) {
        }

        return new BlobContent(
            is_string($type) ? $type : 'application/octet-stream',
            static function () use ($disk, $key) {
                try {
                    return $disk->readStream($key);
                } catch (\Throwable) {
                    // Gone between resolving and streaming.
                    return null;
                }
            },
        );
    }
}
