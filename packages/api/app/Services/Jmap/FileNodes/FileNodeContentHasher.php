<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapContentHashJob;
use App\Models\JmapFileNode;
use App\Services\Jmap\Assembly\StepHasher;
use App\Services\Jmap\Blobs\HashStateCodec;
use App\Services\Jmap\Blobs\JmapBlobLimits;
use App\Storage\WgwStorage;

/**
 * Hashing for files that reach the disk without a WGW write path (SFTP, a
 * hosting file manager, a restored backup, rsync) and for legacy rows
 * (#1500). Reading the bytes is unavoidable, so it is bounded: files up to
 * a small cap are hashed during the reconcile walk within this request's
 * budget; larger ones are hash-pending and hashed later in budgeted steps
 * (FileNodeHashJobRunner).
 *
 * While a hash is pending the node's blobId carries a provisional version:
 * the first 8 hex of sha256("{size}:{mtime}") from the disk at the time of
 * the call. It is recognised as provisional by the node's hash_pending
 * state, never by its format.
 *
 * Scoped per request: the discovery budget is spent once per request.
 */
final class FileNodeContentHasher
{
    private ?int $discoveryBudgetLeft = null;

    public function __construct(private readonly WgwStorage $storage) {}

    /**
     * The sha256 of a discovered file when it is small enough to hash now,
     * or null (the caller marks the node hash-pending).
     */
    public function discover(string $key): ?string
    {
        $size = $this->size($key);
        if ($size === null) {
            return null;
        }
        $this->discoveryBudgetLeft ??= intdiv(JmapBlobLimits::stepBudgetBytes(), 2);
        if ($size > JmapBlobLimits::discoveryHashMaxBytes() || $size > $this->discoveryBudgetLeft) {
            return null;
        }
        $this->discoveryBudgetLeft -= $size;

        return $this->hashWhole($key);
    }

    /**
     * Provisional version token of a hash-pending file, or null when the
     * file is gone.
     */
    public function provisional(string $key): ?string
    {
        $basis = $this->basis($key);

        return $basis === null ? null : substr(hash('sha256', $basis), 0, 8);
    }

    /**
     * "{size}:{mtime}" from the disk, or null when the file is gone.
     */
    public function basis(string $key): ?string
    {
        $disk = $this->storage->files();
        try {
            if (! $disk->fileExists($key)) {
                return null;
            }

            return (int) $disk->size($key).':'.(int) $disk->lastModified($key);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Flags the node hash-pending (the caller saves it) and (re)starts its
     * hash job from byte 0.
     */
    public function markPending(JmapFileNode $node): void
    {
        $node->hash_pending = true;
        $encoded = HashStateCodec::encode(hash_init('sha256'));
        JmapContentHashJob::query()->updateOrCreate(
            ['node_id' => (string) $node->node_id],
            [
                'basis' => $this->basis((string) $node->storage_key) ?? '0:0',
                'hashed_bytes' => 0,
                'hash_state' => $encoded['state'],
                'hash_build' => $encoded['build'],
                'locked_until' => null,
            ],
        );
    }

    public function clearPending(JmapFileNode $node): void
    {
        $node->hash_pending = false;
        JmapContentHashJob::query()->where('node_id', (string) $node->node_id)->delete();
    }

    /**
     * Whole-file streamed hash; only for files within the discovery cap.
     */
    private function hashWhole(string $key): ?string
    {
        $context = hash_init('sha256');
        $size = $this->size($key) ?? 0;
        try {
            $offset = StepHasher::advance($this->storage->files(), $key, $context, 0, $size, $size);
        } catch (\Throwable) {
            return null;
        }

        return $offset === $size ? hash_final($context) : null;
    }

    private function size(string $key): ?int
    {
        try {
            $disk = $this->storage->files();

            return $disk->fileExists($key) ? (int) $disk->size($key) : null;
        } catch (\Throwable) {
            return null;
        }
    }
}
