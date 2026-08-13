<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Drive\DriveShareAuthorizer;
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
        private readonly FileNodeIndexService $index,
    ) {}

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

        return $shape;
    }

    /**
     * Node-derived content blobId: fnb-{nodeId}-{sha8}. The sha component
     * makes the id change with the content (draft-14 allows a mutable
     * blobId; the download resolver verifies it against the current sha).
     */
    public function blobId(JmapFileNode $node): string
    {
        $sha = $this->ensureContentSha($node);

        return 'fnb-'.$node->node_id.'-'.substr($sha, 0, 8);
    }

    public function ensureContentSha(JmapFileNode $node): string
    {
        $existing = $node->content_sha256;
        if (is_string($existing) && $existing !== '') {
            return $existing;
        }

        $key = (string) $node->storage_key;
        $disk = $this->storage->files();
        $sha = hash('sha256', '');
        try {
            $stream = $disk->readStream($key);
            if (is_resource($stream)) {
                $context = hash_init('sha256');
                hash_update_stream($context, $stream);
                fclose($stream);
                $sha = hash_final($context);
            }
        } catch (\Throwable) {
            // Missing content hashes as empty; the download resolver 404s.
        }

        // Persist without bumping change_seq: lazily computing a hash is not
        // a change to the node.
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
            $rights = $this->authorizer->effectiveRights($virtual, $principal);
        } catch (\Throwable) {
            $rights = [];
        }

        $mayView = (bool) ($rights['mayView'] ?? false);
        $mayEdit = (bool) ($rights['mayEditContent'] ?? false);
        $mayStructure = (bool) ($rights['mayManageStructure'] ?? false);

        return [
            'mayRead' => $mayView,
            'mayAddChildren' => $mayStructure,
            'mayRename' => $mayStructure,
            'mayDelete' => $mayStructure,
            'mayModifyContent' => $mayEdit,
            // Sharing writes are out of scope for the envelope (roadmap
            // non-goal); consistent with shareWith: null.
            'mayShare' => false,
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
