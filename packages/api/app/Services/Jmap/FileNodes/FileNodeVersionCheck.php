<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapRequestContext;

/**
 * Per-file version check (#1500), a WGW extension to draft-14 behind
 * https://wegotworkspace.org/jmap/filenode-version-check: the FileNode/set
 * update property `expectedBlobId` and the SetError `versionMismatch`
 * (`existingId`, `existingBlobId`).
 *
 * Not `ifInState` (account-wide) and not onExists "newest" (timestamps
 * only; a missing `modified` defaults to now, so it behaves like replace).
 */
final class FileNodeVersionCheck
{
    public function __construct(
        private readonly FileNodeMapper $mapper,
        private readonly JmapRequestContext $context,
        private readonly FileNodeIndexService $index,
    ) {}

    /**
     * The update keys allowed for this request: `expectedBlobId` only when
     * the capability is in `using`. Without it the key stays unknown and the
     * update fails with invalidProperties — never accepted and ignored,
     * which would be a plain overwrite.
     *
     * @param  list<string>  $base
     * @return list<string>
     */
    public function supportedUpdateProps(array $base): array
    {
        return $this->context->uses(JmapCapabilities::FILENODE_VERSION_CHECK)
            ? [...$base, 'expectedBlobId']
            : $base;
    }

    /**
     * Fails the update unless the node still has the expected blobId. A
     * hash-pending node always mismatches: its id carries size and mtime, a
     * weak version for files written outside WGW.
     */
    public function guard(JmapFileNode $node, mixed $expected): void
    {
        if (! is_string($expected) || $expected === '') {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'expectedBlobId must be a blobId.', 'properties' => ['expectedBlobId']]);
        }
        if ($node->is_dir) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'Directory nodes have no blobId.', 'properties' => ['expectedBlobId']]);
        }
        $current = $this->mapper->blobId($node);
        if ((bool) $node->hash_pending || strlen($current) !== strlen($expected) || ! hash_equals($current, $expected)) {
            throw $this->mismatch($node, $current);
        }
    }

    /**
     * Commit point of a guarded write: a compare-and-swap on the row the
     * guard read. Of two writers holding the same expectedBlobId only one
     * wins; the other fails here, before any byte or name changed. The
     * claim leaves the node hash-pending, so a writer that read after it
     * mismatches too until the write records the true hash.
     *
     * @throws FileNodeSetError
     */
    public function claim(JmapFileNode $loaded): void
    {
        if ($this->index->claimContentWrite($loaded)) {
            return;
        }
        $fresh = JmapFileNode::query()->where('node_id', $loaded->node_id)->first() ?? $loaded;

        throw $this->mismatch($fresh, $this->mapper->blobId($fresh));
    }

    /**
     * Rolls a claim back when the write failed before the content changed.
     */
    public function release(JmapFileNode $loaded): void
    {
        $this->index->releaseContentWrite($loaded);
    }

    private function mismatch(JmapFileNode $node, string $current): FileNodeSetError
    {
        return new FileNodeSetError([
            'type' => 'versionMismatch',
            'description' => 'The file changed since the client read it; nothing was overwritten.',
            'existingId' => (string) $node->node_id,
            'existingBlobId' => $current,
        ]);
    }
}
