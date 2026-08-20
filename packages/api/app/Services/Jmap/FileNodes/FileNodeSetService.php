<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Notes\NoteMarkdownCodec;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;

/**
 * FileNode/set semantics (draft-ietf-jmap-filenode-14 §3.2.3, #450):
 * create/update/destroy against the disk + node index, with sibling
 * uniqueness, onExists (null/replace/rename/newest), onDestroyRemoveChildren
 * + nodeHasChildren, cycle protection on moves, and rights checks via the
 * drive's path-scoped access model.
 *
 * File content follows the copy-on-consume pattern (design decision 6): a
 * create/update references an uploaded `jb-` blob whose bytes are copied
 * into the file; afterwards the node's blobId is the node-derived `fnb-` id
 * and the upload may expire naturally.
 *
 * Note files (`.md` under `.notes`) accept a `note` {title, tags} patch.
 * Frontmatter writes pass through existing YAML `starred` so `/notes/*` still
 * round-trips the old client flag. FileNode `note.starred` is never written.
 */
final class FileNodeSetService
{
    // `modified` is accepted on create solely for onExists=newest
    // comparisons (draft-14); it is not persisted — mtime is the write time
    // (documented deviation: no client-controlled timestamps).
    private const SUPPORTED_CREATE_PROPS = ['parentId', 'name', 'nodeType', 'blobId', 'size', 'type', 'modified', 'note'];

    private const SUPPORTED_UPDATE_PROPS = ['parentId', 'name', 'blobId', 'size', 'note'];

    /** @var array<string, array<string, mixed>> */
    private array $created = [];

    /** @var array<string, array<string, mixed>|null> */
    private array $updated = [];

    /** @var list<string> */
    private array $destroyed = [];

    /** @var array<string, array<string, mixed>> */
    private array $notCreated = [];

    /** @var array<string, array<string, mixed>> */
    private array $notUpdated = [];

    /** @var array<string, array<string, mixed>> */
    private array $notDestroyed = [];

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeMapper $mapper,
        private readonly FileNodeAccountSupport $accounts,
        private readonly JmapBlobService $blobs,
        private readonly WgwStorage $storage,
        private readonly NoteMarkdownCodec $codec,
        private readonly StoragePaths $paths,
    ) {}

    /**
     * @param  array<string, mixed>  $create
     * @param  array<string, mixed>  $update
     * @param  list<mixed>  $destroy
     * @return array<string, mixed>
     */
    public function apply(
        string $username,
        array $create,
        array $update,
        array $destroy,
        ?string $onExists,
        bool $onDestroyRemoveChildren,
        bool $compareCaseInsensitively,
    ): array {
        $this->created = $this->updated = $this->notCreated = $this->notUpdated = $this->notDestroyed = [];
        $this->destroyed = [];

        $principal = $this->accounts->principalFor($username);
        $roots = $this->accounts->rootsFor($username);
        $this->accounts->ensureAccountIndexed($username);

        // Destroys first, deepest-first, so replace/create can reuse names
        // and "all children destroyed in the same operation" holds (§3.2.3).
        $this->applyDestroys($destroy, $principal, $roots, $onDestroyRemoveChildren);

        foreach ($create as $creationId => $payload) {
            $creationId = (string) $creationId;
            if (! is_array($payload)) {
                $this->notCreated[$creationId] = $this->invalidProperties('FileNode create entry must be an object.');

                continue;
            }
            try {
                $this->created[$creationId] = $this->applyCreate($username, $payload, $principal, $roots, $onExists, $onDestroyRemoveChildren, $compareCaseInsensitively);
            } catch (FileNodeSetError $e) {
                $this->notCreated[$creationId] = $e->shape;
            }
        }

        foreach ($update as $nodeId => $patch) {
            $nodeId = (string) $nodeId;
            if (! is_array($patch)) {
                $this->notUpdated[$nodeId] = $this->invalidProperties('FileNode update entry must be an object.');

                continue;
            }
            try {
                $this->updated[$nodeId] = $this->applyUpdate($username, $nodeId, $patch, $principal, $roots, $onExists, $onDestroyRemoveChildren, $compareCaseInsensitively);
            } catch (FileNodeSetError $e) {
                $this->notUpdated[$nodeId] = $e->shape;
            }
        }

        return [
            'created' => $this->created,
            'updated' => $this->updated,
            'destroyed' => $this->destroyed,
            'notCreated' => $this->notCreated,
            'notUpdated' => $this->notUpdated,
            'notDestroyed' => $this->notDestroyed,
        ];
    }

    /**
     * @param  list<mixed>  $destroy
     * @param  array{username: string, role: string}  $principal
     * @param  list<string>  $roots
     */
    private function applyDestroys(array $destroy, array $principal, array $roots, bool $onDestroyRemoveChildren): void
    {
        $targets = [];
        foreach ($destroy as $nodeId) {
            if (! is_string($nodeId) || $nodeId === '') {
                continue;
            }
            $node = $this->accounts->visibleLiveNode($nodeId, $roots);
            if ($node === null) {
                $this->notDestroyed[$nodeId] = ['type' => 'notFound', 'description' => 'FileNode not found.'];

                continue;
            }
            $targets[$nodeId] = $node;
        }

        // Deepest-first so destroying a directory plus its children in one
        // call never trips nodeHasChildren.
        uasort($targets, static fn (JmapFileNode $a, JmapFileNode $b): int => substr_count((string) $b->storage_key, '/') <=> substr_count((string) $a->storage_key, '/'));

        foreach ($targets as $nodeId => $node) {
            try {
                $this->destroyNode($node, $principal, $onDestroyRemoveChildren);
                $this->destroyed[] = $nodeId;
            } catch (FileNodeSetError $e) {
                $this->notDestroyed[$nodeId] = $e->shape;
            }
        }
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function destroyNode(JmapFileNode $node, array $principal, bool $onDestroyRemoveChildren): void
    {
        $key = (string) $node->storage_key;
        if ($node->parent_node_id === null) {
            throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'Root nodes cannot be destroyed.']);
        }
        $rights = $this->mapper->rightsFor($key, $principal);
        if (! $rights['mayDelete']) {
            throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'No permission to destroy this node.']);
        }
        if ($node->is_dir && ! $onDestroyRemoveChildren && $this->index->hasLiveChildren((string) $node->node_id)) {
            throw new FileNodeSetError(['type' => 'nodeHasChildren', 'description' => 'The directory has children; pass onDestroyRemoveChildren to remove them.']);
        }

        $disk = $this->storage->files();
        if ($node->is_dir) {
            $disk->deleteDirectory($key);
        } elseif ($disk->fileExists($key)) {
            $disk->delete($key);
        }
        $this->index->recordDelete($key);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array{username: string, role: string}  $principal
     * @param  list<string>  $roots
     * @return array<string, mixed>
     */
    private function applyCreate(
        string $username,
        array $payload,
        array $principal,
        array $roots,
        ?string $onExists,
        bool $onDestroyRemoveChildren,
        bool $compareCaseInsensitively,
    ): array {
        $unsupported = array_diff(array_keys($payload), self::SUPPORTED_CREATE_PROPS);
        if ($unsupported !== []) {
            throw new FileNodeSetError($this->invalidProperties(
                'Unsupported properties: '.implode(', ', array_map(strval(...), $unsupported)).'.',
                array_values(array_map(strval(...), $unsupported)),
            ));
        }

        if (array_key_exists('target', $payload) || ($payload['nodeType'] ?? null) === 'symlink') {
            throw new FileNodeSetError($this->invalidProperties('Symlink nodes are not supported.', ['nodeType']));
        }

        $parentId = $payload['parentId'] ?? null;
        if (! is_string($parentId) || $parentId === '') {
            // mayCreateTopLevelFileNode is false: roots are fixed.
            throw new FileNodeSetError($this->invalidProperties('parentId is required.', ['parentId']));
        }
        $parent = $this->accounts->visibleLiveNode($parentId, $roots);
        if ($parent === null || ! $parent->is_dir) {
            throw new FileNodeSetError($this->invalidProperties('parentId must reference an existing directory.', ['parentId']));
        }
        if (! $this->mapper->rightsFor((string) $parent->storage_key, $principal)['mayAddChildren']) {
            throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'No permission to create children here.']);
        }

        $name = $this->validName($payload['name'] ?? null);
        $note = $this->notePatch($payload);
        $blobId = $payload['blobId'] ?? null;
        $hasBlob = is_string($blobId) && $blobId !== '';
        $nodeType = $payload['nodeType'] ?? ($hasBlob || $note !== null ? 'file' : 'directory');
        if ($nodeType !== 'file' && $nodeType !== 'directory') {
            throw new FileNodeSetError($this->invalidProperties('nodeType must be "file" or "directory".', ['nodeType']));
        }
        if ($nodeType === 'directory' && $note !== null) {
            throw new FileNodeSetError($this->invalidProperties('Directory nodes must not carry a note projection.', ['note']));
        }
        if ($nodeType === 'file' && ! $hasBlob && $note === null) {
            throw new FileNodeSetError($this->invalidProperties('File nodes require a blobId.', ['blobId']));
        }
        if ($nodeType === 'directory' && $blobId !== null) {
            throw new FileNodeSetError($this->invalidProperties('Directory nodes must not carry a blobId.', ['blobId']));
        }

        $name = $this->resolveCollision($parent, $name, $onExists, $onDestroyRemoveChildren, $compareCaseInsensitively, $principal, $payload);
        $key = $parent->storage_key.'/'.$name;
        $disk = $this->storage->files();

        if ($nodeType === 'directory') {
            $disk->makeDirectory($key);
            $node = $this->index->recordCreate($key);
        } else {
            $blobContents = null;
            if ($hasBlob) {
                $blob = $this->blobs->retrieve($username, (string) $blobId);
                if ($blob === null) {
                    throw new FileNodeSetError($this->invalidProperties('Unknown blobId.', ['blobId']));
                }
                if (array_key_exists('size', $payload) && is_int($payload['size']) && $payload['size'] !== $blob['size']) {
                    throw new FileNodeSetError($this->invalidProperties('size does not match the blob.', ['size']));
                }
                $blobContents = $blob['contents'];
            }
            $contents = $this->contentsForNoteWrite($key, $name, $note, $blobContents, false, null);
            $disk->put($key, $contents);
            $node = $this->index->recordContentWrite($key, hash('sha256', $contents));
        }

        if ($node === null) {
            throw new FileNodeSetError(['type' => 'serverFail', 'description' => 'Could not index the created node.']);
        }

        return $this->mapper->toFileNode($node, $principal);
    }

    /**
     * @param  array<string, mixed>  $patch
     * @param  array{username: string, role: string}  $principal
     * @param  list<string>  $roots
     * @return array<string, mixed>|null
     */
    private function applyUpdate(
        string $username,
        string $nodeId,
        array $patch,
        array $principal,
        array $roots,
        ?string $onExists,
        bool $onDestroyRemoveChildren,
        bool $compareCaseInsensitively,
    ): ?array {
        $node = $this->accounts->visibleLiveNode($nodeId, $roots);
        if ($node === null) {
            throw new FileNodeSetError(['type' => 'notFound', 'description' => 'FileNode not found.']);
        }

        $unsupported = array_diff(array_keys($patch), self::SUPPORTED_UPDATE_PROPS);
        if ($unsupported !== []) {
            throw new FileNodeSetError($this->invalidProperties(
                'Unsupported update properties: '.implode(', ', array_map(strval(...), $unsupported)).'.',
                array_values(array_map(strval(...), $unsupported)),
            ));
        }

        $serverSet = [];
        $note = $this->notePatch($patch);
        $existingStarred = $this->isNoteMarkdownKey((string) $node->storage_key, (string) $node->name)
            ? $this->yamlStarredOf($this->readMarkdown((string) $node->storage_key))
            : null;

        $wantsMove = array_key_exists('name', $patch) || array_key_exists('parentId', $patch);
        if ($wantsMove) {
            if ($node->parent_node_id === null) {
                throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'Root nodes cannot be renamed or moved.']);
            }
            if (! $this->mapper->rightsFor((string) $node->storage_key, $principal)['mayRename']) {
                throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'No permission to rename or move this node.']);
            }

            $newParent = $node->parent_node_id !== null
                ? $this->accounts->visibleLiveNode((string) $node->parent_node_id, $roots)
                : null;
            if (array_key_exists('parentId', $patch)) {
                $parentId = $patch['parentId'];
                if (! is_string($parentId) || $parentId === '') {
                    throw new FileNodeSetError($this->invalidProperties('parentId must reference a directory.', ['parentId']));
                }
                $newParent = $this->accounts->visibleLiveNode($parentId, $roots);
            }
            if ($newParent === null || ! $newParent->is_dir) {
                throw new FileNodeSetError($this->invalidProperties('parentId must reference an existing directory.', ['parentId']));
            }
            if (! $this->mapper->rightsFor((string) $newParent->storage_key, $principal)['mayAddChildren']) {
                throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'No permission to move into the target directory.']);
            }
            // Cycle protection (§3.2.3): the destination must not be the
            // node itself or one of its descendants.
            if ($newParent->node_id === $node->node_id
                || str_starts_with($newParent->storage_key.'/', $node->storage_key.'/')) {
                throw new FileNodeSetError($this->invalidProperties('Cannot move a node into itself.', ['parentId']));
            }

            $newName = array_key_exists('name', $patch)
                ? $this->validName($patch['name'])
                : (string) $node->name;
            $newName = $this->resolveCollision($newParent, $newName, $onExists, $onDestroyRemoveChildren, $compareCaseInsensitively, $principal, $patch, (string) $node->node_id);

            $fromKey = (string) $node->storage_key;
            $toKey = $newParent->storage_key.'/'.$newName;
            if ($toKey !== $fromKey) {
                if (! $this->storage->files()->move($fromKey, $toKey)) {
                    throw new FileNodeSetError(['type' => 'serverFail', 'description' => 'Move failed.']);
                }
                $node = $this->index->recordMove($fromKey, $toKey) ?? $node;
            }
        }

        $wantsContent = array_key_exists('blobId', $patch) || $note !== null;
        if ($wantsContent) {
            if ($node->is_dir) {
                throw new FileNodeSetError($this->invalidProperties(
                    'Directory nodes have no content.',
                    array_key_exists('blobId', $patch) ? ['blobId'] : ['note'],
                ));
            }
            if (! $this->mapper->rightsFor((string) $node->storage_key, $principal)['mayModifyContent']) {
                throw new FileNodeSetError(['type' => 'forbidden', 'description' => 'No permission to modify content.']);
            }
            $blobContents = null;
            if (array_key_exists('blobId', $patch)) {
                $blobId = $patch['blobId'];
                if (! is_string($blobId) || $blobId === '') {
                    throw new FileNodeSetError($this->invalidProperties('blobId must be a non-empty id.', ['blobId']));
                }
                $blob = $this->blobs->retrieve($username, $blobId);
                if ($blob === null) {
                    throw new FileNodeSetError($this->invalidProperties('Unknown blobId.', ['blobId']));
                }
                if (array_key_exists('size', $patch) && is_int($patch['size']) && $patch['size'] !== $blob['size']) {
                    throw new FileNodeSetError($this->invalidProperties('size does not match the blob.', ['size']));
                }
                $blobContents = $blob['contents'];
            }
            $contents = $this->contentsForNoteWrite(
                (string) $node->storage_key,
                (string) $node->name,
                $note,
                $blobContents,
                $this->isNoteMarkdownKey((string) $node->storage_key, (string) $node->name),
                $existingStarred,
            );
            $this->storage->files()->put((string) $node->storage_key, $contents);
            $node = $this->index->recordContentWrite((string) $node->storage_key, hash('sha256', $contents)) ?? $node;
            $shape = $this->mapper->toFileNode($node, $principal);
            $serverSet['size'] = $shape['size'];
            $serverSet['blobId'] = $shape['blobId'];
            if (isset($shape['note'])) {
                $serverSet['note'] = $shape['note'];
            }
        }

        return $serverSet === [] ? null : $serverSet;
    }

    /**
     * Sibling-uniqueness + onExists handling (§3.2.3). Returns the name to
     * use (possibly server-chosen for "rename").
     *
     * @param  array{username: string, role: string}  $principal
     * @param  array<string, mixed>  $payload
     */
    private function resolveCollision(
        JmapFileNode $parent,
        string $name,
        ?string $onExists,
        bool $onDestroyRemoveChildren,
        bool $compareCaseInsensitively,
        array $principal,
        array $payload,
        ?string $ignoreNodeId = null,
    ): string {
        $existing = $this->findSibling($parent, $name, $compareCaseInsensitively, $ignoreNodeId);
        if ($existing === null) {
            return $name;
        }

        switch ($onExists) {
            case 'replace':
                $this->destroyNode($existing, $principal, $onDestroyRemoveChildren);
                $this->destroyed[] = (string) $existing->node_id;

                return $name;
            case 'rename':
                for ($i = 2; $i < 1000; $i++) {
                    $candidate = $this->numberedName($name, $i);
                    if ($this->findSibling($parent, $candidate, $compareCaseInsensitively, $ignoreNodeId) === null) {
                        return $candidate;
                    }
                }
                throw new FileNodeSetError(['type' => 'serverFail', 'description' => 'Could not allocate a unique name.']);
            case 'newest':
                $incoming = $payload['modified'] ?? null;
                $incomingTs = is_string($incoming) ? strtotime($incoming) : time();
                $existingTs = 0;
                try {
                    $existingTs = (int) $this->storage->files()->lastModified((string) $existing->storage_key);
                } catch (\Throwable) {
                }
                if ($incomingTs !== false && $incomingTs > $existingTs) {
                    $this->destroyNode($existing, $principal, $onDestroyRemoveChildren);
                    $this->destroyed[] = (string) $existing->node_id;

                    return $name;
                }
                throw new FileNodeSetError([
                    'type' => 'alreadyExists',
                    'description' => 'A newer sibling with this name exists.',
                    'existingId' => (string) $existing->node_id,
                ]);
            default:
                throw new FileNodeSetError([
                    'type' => 'alreadyExists',
                    'description' => 'A sibling with this name exists.',
                    'existingId' => (string) $existing->node_id,
                ]);
        }
    }

    private function findSibling(JmapFileNode $parent, string $name, bool $caseInsensitive, ?string $ignoreNodeId): ?JmapFileNode
    {
        foreach ($this->index->liveChildren((string) $parent->node_id) as $child) {
            if ($ignoreNodeId !== null && (string) $child->node_id === $ignoreNodeId) {
                continue;
            }
            $matches = $caseInsensitive
                ? mb_strtolower((string) $child->name) === mb_strtolower($name)
                : (string) $child->name === $name;
            if ($matches) {
                return $child;
            }
        }

        return null;
    }

    private function numberedName(string $name, int $number): string
    {
        $dot = strrpos($name, '.');
        if ($dot !== false && $dot > 0) {
            return substr($name, 0, $dot).' ('.$number.')'.substr($name, $dot);
        }

        return $name.' ('.$number.')';
    }

    private function validName(mixed $name): string
    {
        if (! is_string($name)) {
            throw new FileNodeSetError($this->invalidProperties('name is required.', ['name']));
        }
        $name = trim($name);
        if (
            $name === ''
            || $name === '.'
            || $name === '..'
            || str_contains($name, '/')
            || str_contains($name, '\\')
            || str_contains($name, "\0")
            || strlen($name) > 255
        ) {
            throw new FileNodeSetError($this->invalidProperties('Invalid node name.', ['name']));
        }

        return $name;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{title?: string, tags?: list<string>}|null
     */
    private function notePatch(array $payload): ?array
    {
        if (! array_key_exists('note', $payload)) {
            return null;
        }
        $note = $payload['note'];
        if (! is_array($note) || array_is_list($note)) {
            throw new FileNodeSetError($this->invalidProperties('note must be an object.', ['note']));
        }
        $unsupported = array_diff(array_keys($note), ['title', 'tags']);
        if ($unsupported !== []) {
            throw new FileNodeSetError($this->invalidProperties(
                'Unsupported note properties: '.implode(', ', array_map(strval(...), $unsupported)).'.',
                ['note'],
            ));
        }
        $out = [];
        if (array_key_exists('title', $note)) {
            if (! is_string($note['title'])) {
                throw new FileNodeSetError($this->invalidProperties('note.title must be a string.', ['note']));
            }
            $out['title'] = $note['title'];
        }
        if (array_key_exists('tags', $note)) {
            $out['tags'] = $this->codec->normalizeTags($note['tags']);
        }

        return $out;
    }

    private function isNoteMarkdownKey(string $key, string $name): bool
    {
        return $this->paths->isNotePath('/'.ltrim($key, '/')) && $this->codec->isNoteFilename($name);
    }

    private function yamlStarredOf(string $markdown): ?bool
    {
        return $this->codec->parse($markdown, '')[2];
    }

    private function readMarkdown(string $key): string
    {
        $disk = $this->storage->files();
        try {
            return $disk->exists($key) ? (string) $disk->get($key) : '';
        } catch (\Throwable) {
            return '';
        }
    }

    /**
     * @param  array{title?: string, tags?: list<string>}|null  $note
     */
    private function composeNoteMarkdown(string $name, ?array $note, string $sourceMarkdown, ?bool $starred): string
    {
        $fallback = pathinfo($name, PATHINFO_FILENAME);
        [$title, $tags, , $body] = $this->codec->parse($sourceMarkdown, $fallback);
        if ($note !== null) {
            if (array_key_exists('title', $note)) {
                $title = $note['title'] !== '' ? $note['title'] : $fallback;
            }
            if (array_key_exists('tags', $note)) {
                $tags = $note['tags'];
            }
        }

        return $this->codec->serialize($title, $tags, $starred, $body);
    }

    /**
     * @param  array{title?: string, tags?: list<string>}|null  $note
     */
    private function contentsForNoteWrite(
        string $key,
        string $name,
        ?array $note,
        ?string $blobContents,
        bool $passThroughExistingStarred,
        ?bool $existingStarred,
    ): string {
        $isNote = $this->isNoteMarkdownKey($key, $name);
        if ($note !== null && ! $isNote) {
            throw new FileNodeSetError($this->invalidProperties('note is only valid on markdown files under .notes.', ['note']));
        }
        if (! $isNote) {
            if ($blobContents === null) {
                throw new FileNodeSetError($this->invalidProperties('File nodes require a blobId.', ['blobId']));
            }

            return $blobContents;
        }

        $source = $blobContents ?? $this->readMarkdown($key);
        if ($note === null && ! $passThroughExistingStarred) {
            return $source;
        }
        $starred = $passThroughExistingStarred ? $existingStarred : $this->yamlStarredOf($source);

        return $this->composeNoteMarkdown($name, $note, $source, $starred);
    }

    /**
     * @param  list<string>  $properties
     * @return array<string, mixed>
     */
    private function invalidProperties(string $description, array $properties = []): array
    {
        return ['type' => 'invalidProperties', 'description' => $description, 'properties' => $properties];
    }
}
