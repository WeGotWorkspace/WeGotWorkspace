<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\DriveStarredItem;
use App\Models\JmapFileNode;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Notes\NoteMarkdownCodec;
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
 *
 * `.md` files under `.notes` also carry a `note` projection (title/tags/excerpt
 * from {@see NoteMarkdownCodec}, notebook/archived from storage_key, starred
 * from the caller's DriveStarredItem). YAML `starred` is not read.
 */
final class FileNodeMapper
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly DriveShareAuthorizer $authorizer,
        private readonly StoragePaths $paths,
        private readonly NoteMarkdownCodec $codec,
        private readonly DriveGroupResolver $groups,
    ) {}

    /**
     * @param  list<JmapFileNode>  $nodes
     * @param  array{username: string, role: string}  $principal
     * @return list<array<string, mixed>>
     */
    public function toFileNodes(array $nodes, array $principal): array
    {
        $starredPaths = $this->starredPathsFor((string) $principal['username']);

        return array_values(array_map(
            fn (JmapFileNode $node): array => $this->toFileNode($node, $principal, $starredPaths),
            $nodes,
        ));
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @param  array<string, true>|null  $starredPaths
     * @return array<string, mixed>
     */
    public function toFileNode(JmapFileNode $node, array $principal, ?array $starredPaths = null): array
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

        $note = $this->noteProjection(
            $node,
            $starredPaths ?? $this->starredPathsFor((string) $principal['username']),
        );
        if ($note !== null) {
            $shape['note'] = $note;
        }

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
        $mayShare = (bool) ($rights['mayShare'] ?? false);
        // REST note-path rights stay view|edit (no structure) for shares.
        // FileNode/set still needs owner/member structure on their `.notes` tree.
        $username = (string) ($principal['username'] ?? '');
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
            'mayRename' => $mayStructure,
            'mayDelete' => $mayStructure,
            'mayModifyContent' => $mayEdit,
            // shareWith writes stay off the envelope; mayShare still
            // reflects DriveShareAuthorizer so the REST share dialog shows.
            'mayShare' => $mayShare,
        ];
    }

    /**
     * List-row note projection for `.md` files under `.notes`. Starred is the
     * calling principal's Drive star — YAML `starred` is never read here.
     *
     * @param  array<string, true>  $starredPaths
     * @return array{title: string, tags: list<string>, excerpt: string, notebook: string, archived: bool, starred: bool}|null
     */
    public function noteProjection(JmapFileNode $node, array $starredPaths): ?array
    {
        if ($node->is_dir) {
            return null;
        }
        $key = (string) $node->storage_key;
        $virtual = '/'.ltrim($key, '/');
        if (! $this->paths->isNotePath($virtual) || ! $this->codec->isNoteFilename((string) $node->name)) {
            return null;
        }

        $fallback = pathinfo((string) $node->name, PATHINFO_FILENAME);
        $markdown = '';
        try {
            $markdown = (string) $this->storage->files()->get($key);
        } catch (\Throwable) {
            // Missing bytes still project path-derived fields.
        }
        [$title, $tags] = $this->codec->parse($markdown, $fallback);
        if ($this->codec->isPlaceholderTitle($title, $fallback)) {
            $title = '';
        }

        return [
            'title' => $title,
            'tags' => $tags,
            'excerpt' => $this->codec->listPreview($markdown, $fallback),
            'notebook' => $this->paths->noteNotebookFromKey($key),
            'archived' => $this->paths->isNotesArchivePath($virtual),
            'starred' => isset($starredPaths[$this->paths->normalizeVirtualPath($virtual)]),
        ];
    }

    /**
     * @return array<string, true>
     */
    public function starredPathsFor(string $username): array
    {
        $out = [];
        foreach (DriveStarredItem::query()->where('username', $username)->pluck('path') as $path) {
            if (! is_string($path) || $path === '') {
                continue;
            }
            $out[$this->paths->normalizeVirtualPath($path)] = true;
        }

        return $out;
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
