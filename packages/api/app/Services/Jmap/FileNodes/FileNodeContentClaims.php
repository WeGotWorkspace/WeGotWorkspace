<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapContentHashJob;
use App\Models\JmapFileNode;
use Illuminate\Support\Facades\DB;

/**
 * Content-version transitions of an indexed file (#1500) outside the write
 * itself: the compare-and-swap a guarded write (expectedBlobId) claims
 * before it changes any byte, its rollback, and the true hash a background
 * hash job resolves for a hash-pending node. Each bumps change_seq, so
 * FileNode/changes reports the blobId move.
 */
final class FileNodeContentClaims
{
    public function __construct(
        private readonly FileNodeSequence $seq,
        private readonly FileNodeContentHasher $hasher,
        private readonly FileNodeRootMarkers $markers,
    ) {}

    /**
     * Compare-and-swap before a guarded content write: succeeds only while
     * the row still has the change_seq the caller read and is not hash
     * pending, then marks it pending (a provisional version that never
     * equals an expectedBlobId) and bumps change_seq. The write's
     * recordContentWrite stores the true hash and clears it.
     */
    public function claim(JmapFileNode $loaded): bool
    {
        $seq = $this->seq->next();
        $claimed = JmapFileNode::query()
            ->where('node_id', (string) $loaded->node_id)
            ->whereNull('deleted_at')
            ->where('change_seq', $loaded->change_seq)
            ->where('hash_pending', false)
            ->update(['hash_pending' => true, 'change_seq' => $seq]);
        if ($claimed !== 1) {
            return false;
        }
        $fresh = JmapFileNode::query()->where('node_id', (string) $loaded->node_id)->first();
        if ($fresh !== null) {
            $this->hasher->markPending($fresh);
        }

        return true;
    }

    /**
     * Undoes claim() when the write failed before any byte
     * changed: the node is no longer hash-pending, so a retry with the same
     * expectedBlobId is not a versionMismatch.
     */
    public function release(JmapFileNode $loaded): void
    {
        $seq = $this->seq->next();
        JmapFileNode::query()
            ->where('node_id', (string) $loaded->node_id)
            ->where('hash_pending', true)
            ->update(['hash_pending' => false, 'change_seq' => $seq]);
        JmapContentHashJob::query()->where('node_id', (string) $loaded->node_id)->delete();
    }

    /**
     * Stores the true hash a hash job computed for a hash-pending node and
     * bumps change_seq, so FileNode/changes tells clients the blobId moved
     * (once per discovered file).
     */
    public function recordHashResolved(JmapFileNode $node, string $sha256, int $size): void
    {
        // One transaction: the job row is deleted only while the runner's
        // lease on it is intact (a write that restarted or cleared the job
        // resets it), and the node is updated only while still pending. A
        // PUT that landed meanwhile is never overwritten with old bytes.
        $seq = $this->seq->next();
        try {
            $applied = DB::connection('wgw')->transaction(function () use ($node, $sha256, $size, $seq): bool {
                $deleted = JmapContentHashJob::query()
                    ->where('node_id', (string) $node->node_id)
                    ->whereNotNull('locked_until')
                    ->delete();
                if ($deleted !== 1) {
                    return false;
                }
                $updated = JmapFileNode::query()
                    ->where('node_id', (string) $node->node_id)
                    ->where('hash_pending', true)
                    ->update(['content_sha256' => $sha256, 'size_bytes' => $size, 'hash_pending' => false, 'change_seq' => $seq]);
                if ($updated !== 1) {
                    // Rolls the job delete back; the node is no longer pending.
                    throw new \RuntimeException('The node is no longer hash-pending.');
                }

                return true;
            });
        } catch (\RuntimeException) {
            return;
        }
        if ($applied) {
            $this->markers->touch((string) $node->storage_key);
        }
    }
}
