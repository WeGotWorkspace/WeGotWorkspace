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
        if ((bool) $node->hash_pending || ! hash_equals($current, $expected)) {
            throw new FileNodeSetError([
                'type' => 'versionMismatch',
                'description' => 'The file changed since the client read it; nothing was overwritten.',
                'existingId' => (string) $node->node_id,
                'existingBlobId' => $current,
            ]);
        }
    }
}
