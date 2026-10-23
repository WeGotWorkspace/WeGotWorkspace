<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapRequestContext;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;

/**
 * JmapFileNode row → draft-ietf-jmap-filenode-14 FileNode object.
 *
 * myRights derives at read time from the existing path-scoped
 * DriveShareAuthorizer (design decision 5); content blobIds are node-derived
 * (`fnb-{nodeId}-{sha8}`) and stream from disk via /jmap/download (decision
 * 6). `modified`/`accessed` map to the disk mtime and `changed` to the index
 * row's update time — documented deviations (no per-client timestamps).
 */
final class FileNodeMapper
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly DriveShareAuthorizer $authorizer,
        private readonly StoragePaths $paths,
        private readonly DriveGroupResolver $groups,
        private readonly FileNodeContentHasher $hasher,
        private readonly JmapRequestContext $context,
    ) {}

    /**
     * @param  list<JmapFileNode>  $nodes
     * @param  array{username: string, role: string}  $principal
     * @return list<array<string, mixed>>
     */
    public function toFileNodes(array $nodes, array $principal): array
    {
        return array_map(
            fn (JmapFileNode $node): array => $this->toFileNode($node, $principal),
            $nodes,
        );
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array<string, mixed>
     */
    public function toFileNode(JmapFileNode $node, array $principal): array
    {
        $key = (string) $node->storage_key;
        $disk = $this->storage->files();
        $isDir = (bool) $node->is_dir;

        $mtime = null;
        try {
            $mtime = $disk->lastModified($key);
        } catch (\Throwable) {
            // Node vanished out-of-band; fall back to index timestamps.
        }
        $modified = $mtime !== null
            ? gmdate('Y-m-d\TH:i:s\Z', (int) $mtime)
            : $node->updated_at?->toIso8601ZuluString() ?? gmdate('Y-m-d\TH:i:s\Z');

        $rights = $this->rightsFor($key, $principal);

        $shape = [
            'id' => (string) $node->node_id,
            'parentId' => $node->parent_node_id !== null ? (string) $node->parent_node_id : null,
            'nodeType' => $isDir ? 'directory' : 'file',
            'blobId' => $isDir ? null : $this->blobId($node),
            'target' => null,
            'size' => $isDir ? null : (int) ($node->size_bytes ?? 0),
            'name' => (string) $node->name,
            'type' => $isDir ? null : $this->mediaType($key),
            'created' => $node->created_at?->toIso8601ZuluString() ?? $modified,
            'modified' => $modified,
            'accessed' => $modified,
            'changed' => $node->updated_at?->toIso8601ZuluString() ?? $modified,
            'executable' => false,
            'isSubscribed' => true,
            'myRights' => $rights,
            'shareWith' => null,
            'role' => null,
        ];
        if (! $isDir && $this->context->uses(JmapCapabilities::FILENODE_VERSION_CHECK)) {
            // WGW version-check extension: the client does not offer
            // *Replace* for a file whose true hash is still pending.
            $shape['contentHashPending'] = (bool) $node->hash_pending;
        }

        return $shape;
    }

    /**
     * Node-derived content blobId: fnb-{nodeId}-{8 hex}. The 8 hex are the
     * start of the true sha256, so the id changes with the content
     * (draft-14 allows a mutable blobId). While the node's hash is pending
     * they are a provisional version from size and mtime instead; the id
     * changes once more when the true hash lands.
     */
    public function blobId(JmapFileNode $node): string
    {
        $sha = $this->ensureContentSha($node);
        if ($sha !== null) {
            return 'fnb-'.$node->node_id.'-'.substr($sha, 0, 8);
        }

        return 'fnb-'.$node->node_id.'-'.($this->hasher->provisional((string) $node->storage_key) ?? '00000000');
    }

    /**
     * Whether $blobId is the node's current blobId: the same strict
     * comparison for a content hash and for a provisional version, so a
     * provisional id minted before an out-of-band overwrite is a miss.
     */
    public function isCurrentBlobId(JmapFileNode $node, string $blobId): bool
    {
        if ((bool) $node->is_dir) {
            return false;
        }
        if ((bool) $node->hash_pending && $this->hasher->provisional((string) $node->storage_key) === null) {
            return false;
        }

        return hash_equals($this->blobId($node), $blobId);
    }

    /**
     * The node's true sha256, or null while it is hash-pending. Legacy rows
     * without a hash go through the same bounded hashing as discovered
     * files: hashed now when small, otherwise marked hash-pending — a large
     * file is never hashed whole inside a request.
     */
    public function ensureContentSha(JmapFileNode $node): ?string
    {
        if ((bool) $node->hash_pending || (bool) $node->is_dir) {
            return null;
        }
        $existing = $node->content_sha256;
        if (is_string($existing) && $existing !== '') {
            return $existing;
        }

        $sha = $this->hasher->discover((string) $node->storage_key);
        if ($sha === null) {
            if ($this->hasher->basis((string) $node->storage_key) === null) {
                // Missing content: the download resolver 404s.
                return hash('sha256', '');
            }
            $this->hasher->markPending($node);
            $node->saveQuietly();

            return null;
        }
        // Persist without bumping change_seq: this id was never exposed in
        // another form, so nothing about the node changed.
        $node->content_sha256 = $sha;
        $node->saveQuietly();

        return $sha;
    }

    /**
     * Draft-14 FilesRights from the drive's path-scoped access model.
     *
     * @param  array{username: string, role: string}  $principal
     * @return array<string, bool>
     */
    public function rightsFor(string $key, array $principal): array
    {
        $virtual = '/'.ltrim($key, '/');
        try {
            $context = $this->authorizer->resolvePathContext($virtual, $principal);
            $rights = $context['rights'];
            $isGrantRoot = $context['scopeRoot'] !== null
                && $context['scopeRoot'] === $this->paths->normalizeVirtualPath($virtual);
        } catch (\Throwable) {
            $rights = [];
            $isGrantRoot = false;
        }

        $mayView = (bool) ($rights['mayView'] ?? false);
        $mayEdit = (bool) ($rights['mayEditContent'] ?? false);
        $mayStructure = (bool) ($rights['mayManageStructure'] ?? false);
        $mayShare = (bool) ($rights['mayShare'] ?? false);
        // REST note-path rights stay view|edit (no structure) for shares.
        // FileNode/set still needs owner/member structure on their `.notes` tree.
        $username = (string) $principal['username'];
        if (
            $this->paths->isNotePath($virtual)
            && $username !== ''
            && $this->paths->isPathAllowed($virtual, $username, $this->groups->allowedGroupSlugs($username), false)
        ) {
            $mayStructure = $mayView;
        }

        return [
            'mayRead' => $mayView,
            'mayAddChildren' => $mayStructure,
            'mayRename' => $mayStructure && ! $isGrantRoot,
            'mayDelete' => $mayStructure && ! $isGrantRoot,
            'mayModifyContent' => $mayEdit,
            // shareWith writes stay off the envelope; mayShare still
            // reflects DriveShareAuthorizer so the REST share dialog shows.
            'mayShare' => $mayShare,
        ];
    }

    private function mediaType(string $key): string
    {
        try {
            $type = $this->storage->files()->mimeType($key);
        } catch (\Throwable) {
            $type = false;
        }

        return is_string($type) && $type !== '' ? $type : 'application/octet-stream';
    }
}
