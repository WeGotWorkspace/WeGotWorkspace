<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapContentHashJob;
use App\Models\JmapFileNode;
use App\Models\JmapFileNodeMeta;
use App\Services\Collab\CollabSidecarMover;
use App\Services\Collab\DocYjsStateStore;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Storage\StorageKeyClass;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The FileNode node-identity index (#450, design: docs/files/jmap-filenode-design.md):
 * stable `fn-` ids over the path-addressed drive, with a global monotonic
 * change sequence and tombstones powering FileNode/changes. Maintained
 * best-effort from both write paths (DriveService and the DAV
 * FileNodeIndexPlugin) and reconciled lazily on reads plus via the
 * wgw:jmap:filenodes-reindex command ({@see FileNodeReindexer}) —
 * out-of-band writes are expected, not fatal (an out-of-band rename is
 * indistinguishable from delete+create and changes the node id; documented
 * deviation).
 *
 * Every seq bump also touches the Drive root markers of the key
 * ({@see FileNodeRootMarkers}); each public write is one marker batch, so a
 * write bumps each root once.
 */
final class FileNodeIndexService
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly SearchIndexerService $search,
        private readonly BestEffortSearchIndexSync $searchSync,
        private readonly CollabSidecarMover $sidecars,
        private readonly DocYjsStateStore $sidecarLinks,
        private readonly FileNodeContentHasher $hasher,
        private readonly FileNodeRootMarkers $markers,
    ) {}

    // ---------------------------------------------------------------
    // Sequence + state

    public function currentSeq(): int
    {
        return (int) ($this->meta()->seq ?? 0);
    }

    public function prunedSeq(): int
    {
        return (int) ($this->meta()->pruned_seq ?? 0);
    }

    private function nextSeq(): int
    {
        return DB::connection('wgw')->transaction(function (): int {
            $meta = JmapFileNodeMeta::query()->lockForUpdate()->first();
            if ($meta === null) {
                $meta = JmapFileNodeMeta::query()->create(['seq' => 0, 'pruned_seq' => 0]);
            }
            $meta->seq = (int) $meta->seq + 1;
            $meta->save();

            return (int) $meta->seq;
        });
    }

    private function meta(): JmapFileNodeMeta
    {
        return JmapFileNodeMeta::query()->first()
            ?? JmapFileNodeMeta::query()->create(['seq' => 0, 'pruned_seq' => 0]);
    }

    // ---------------------------------------------------------------
    // Visibility

    /**
     * Storage-key prefixes of the account's own tree: the personal home plus
     * member group trees. Live member-grant share roots are visible to the
     * grantee (#990) but are not minted here — FileNodeAccountSupport indexes
     * them with their real parent.
     *
     * @param  list<string>  $groupSlugs
     * @return list<string>
     */
    public function visibleRoots(string $username, array $groupSlugs): array
    {
        $roots = ['users/'.$username];
        foreach ($groupSlugs as $slug) {
            $roots[] = 'groups/'.$slug;
        }

        return $roots;
    }

    /**
     * @param  list<string>  $roots
     */
    public function isVisibleKey(string $key, array $roots): bool
    {
        foreach ($roots as $root) {
            if ($key === $root || str_starts_with($key, $root.'/')) {
                return true;
            }
        }

        return false;
    }

    private function isHiddenKey(string $key): bool
    {
        return ! StorageKeyClass::classify($key)->isFileIndexed();
    }

    /** A key the index keeps a node for: rooted under users/ or groups/ and not hidden. */
    public function isIndexableKey(string $key): bool
    {
        return ! $this->isHiddenKey($key) && $this->isRootedKey($key);
    }

    private function syncSearch(string $key, bool $deleted = false): void
    {
        $this->searchSync->sync(
            'filenode',
            fn () => $deleted
                ? $this->search->deleteDavPath('files/'.$key)
                : $this->search->indexFileStorageKey($key),
            'files/'.$key,
        );
    }

    // ---------------------------------------------------------------
    // Lookups

    public function liveByNodeId(string $nodeId): ?JmapFileNode
    {
        return JmapFileNode::query()
            ->where('node_id', $nodeId)
            ->whereNull('deleted_at')
            ->first();
    }

    public function liveByKey(string $key): ?JmapFileNode
    {
        return JmapFileNode::query()
            ->where('storage_key', $key)
            ->whereNull('deleted_at')
            ->first();
    }

    /**
     * @return list<JmapFileNode>
     */
    public function liveChildren(string $parentNodeId): array
    {
        return array_values(JmapFileNode::query()
            ->where('parent_node_id', $parentNodeId)
            ->whereNull('deleted_at')
            ->orderBy('storage_key')
            ->get()
            ->all());
    }

    public function hasLiveChildren(string $parentNodeId): bool
    {
        return JmapFileNode::query()
            ->where('parent_node_id', $parentNodeId)
            ->whereNull('deleted_at')
            ->exists();
    }

    /**
     * All live rows under the visible roots, ordered by key.
     *
     * @param  list<string>  $roots
     * @return list<JmapFileNode>
     */
    public function liveVisible(array $roots): array
    {
        $query = JmapFileNode::query()->whereNull('deleted_at');
        $query->where(function ($outer) use ($roots): void {
            foreach ($roots as $root) {
                $outer->orWhere('storage_key', $root)
                    ->orWhereRaw("storage_key LIKE ? ESCAPE '!'", [$this->escapeLike($root).'/%']);
            }
        });

        return array_values($query->orderBy('storage_key')->get()->all());
    }

    /**
     * Live row at `$key` plus live descendants (storage-key prefix).
     *
     * @return list<JmapFileNode>
     */
    public function liveSelfAndDescendants(string $key): array
    {
        $key = trim($key, '/');
        if ($key === '') {
            return [];
        }

        return array_values(JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where(function ($query) use ($key): void {
                $query->where('storage_key', $key)
                    ->orWhereRaw("storage_key LIKE ? ESCAPE '!'", [$this->escapeLike($key).'/%']);
            })
            ->orderBy('storage_key')
            ->get()
            ->filter(static fn (JmapFileNode $row): bool => (string) $row->storage_key === $key
                || str_starts_with((string) $row->storage_key, $key.'/'))
            ->all());
    }

    // ---------------------------------------------------------------
    // Recording (called from DriveService, the DAV plugin, and FileNode/set)

    /**
     * Indexes a new key. `$sha256` is the hash a WGW write path computed
     * while streaming the bytes; without one the file was discovered on
     * disk and is hashed now (small files) or marked hash-pending.
     * Directories keep a null hash.
     */
    public function recordCreate(string $key, ?string $sha256 = null): ?JmapFileNode
    {
        return $this->markers->batch(fn (): ?JmapFileNode => $this->createNode($key, $sha256));
    }

    private function createNode(string $key, ?string $sha256): ?JmapFileNode
    {
        if ($this->isHiddenKey($key)) {
            return null;
        }
        $existing = $this->liveByKey($key);
        if ($existing !== null) {
            return $this->recordContentWrite($key, $sha256) ?? $existing;
        }

        $parent = $this->ensureParentIndexed($key);
        $disk = $this->storage->files();
        $isDir = $disk->directoryExists($key);
        if (! $isDir && ! $disk->fileExists($key)) {
            return null;
        }

        $sha256 ??= $isDir ? null : $this->hasher->discover($key);
        $seq = $this->nextSeq();

        $node = JmapFileNode::query()->create([
            'node_id' => $this->mintNodeId(),
            'storage_key' => $key,
            'parent_node_id' => $parent?->node_id,
            'name' => basename($key),
            'is_dir' => $isDir,
            'size_bytes' => $isDir ? null : (int) ($disk->size($key) ?: 0),
            'content_sha256' => $sha256,
            'hash_pending' => false,
            'created_seq' => $seq,
            'change_seq' => $seq,
        ]);
        if (! $isDir && $sha256 === null) {
            $this->hasher->markPending($node);
            $node->saveQuietly();
        }
        $this->markers->touch($key);
        $this->syncSearch($key);

        return $node;
    }

    /**
     * The chokepoint for content writes (#1500): `content_sha256` is always
     * the true sha256 of the file's bytes. Every WGW write path passes the
     * hash it computed while streaming the write; a missing hash never
     * nulls the stored value — the file is hashed now (small) or marked
     * hash-pending, as a discovered file would be.
     */
    public function recordContentWrite(string $key, ?string $sha256 = null): ?JmapFileNode
    {
        return $this->markers->batch(fn (): ?JmapFileNode => $this->writeContent($key, $sha256));
    }

    private function writeContent(string $key, ?string $sha256): ?JmapFileNode
    {
        if ($this->isHiddenKey($key)) {
            return null;
        }
        $row = $this->liveByKey($key);
        if ($row === null) {
            return $this->recordCreate($key, $sha256);
        }

        $disk = $this->storage->files();
        $row->size_bytes = $row->is_dir ? null : (int) ($disk->size($key) ?: 0);
        if (! $row->is_dir) {
            $sha256 ??= $this->hasher->discover($key);
            if ($sha256 !== null) {
                $row->content_sha256 = $sha256;
                $this->hasher->clearPending($row);
            } else {
                $this->hasher->markPending($row);
            }
        }
        $row->change_seq = $this->nextSeq();
        $row->save();
        $this->markers->touch($key);
        $this->syncSearch($key);

        return $row;
    }

    /**
     * Compare-and-swap before a guarded content write: succeeds only while
     * the row still has the change_seq the caller read and is not hash
     * pending, then marks it pending (a provisional version that never
     * equals an expectedBlobId) and bumps change_seq. The write's
     * recordContentWrite stores the true hash and clears it.
     */
    public function claimContentWrite(JmapFileNode $loaded): bool
    {
        $seq = $this->nextSeq();
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
        $seq = $this->nextSeq();
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

    /**
     * DAV COPY: the destination has identical bytes, so the destination rows
     * for the whole subtree are inserted in one bulk statement that maps the
     * source storage_key prefix onto the destination and carries size_bytes
     * and content_sha256 (and a pending hash) across — no file is read.
     */
    public function recordCopy(string $fromKey, string $toKey, bool $recursive = true): ?JmapFileNode
    {
        return $this->markers->batch(fn (): ?JmapFileNode => $this->copySubtree($fromKey, $toKey, $recursive));
    }

    private function copySubtree(string $fromKey, string $toKey, bool $recursive): ?JmapFileNode
    {
        if ($this->isHiddenKey($toKey)) {
            return null;
        }
        $source = $this->isHiddenKey($fromKey) ? [] : $this->liveSubtree($fromKey);
        if (! $recursive) {
            // Depth: 0 copies the collection itself, not what is inside.
            $source = array_values(array_filter($source, static fn (JmapFileNode $row): bool => (string) $row->storage_key === $fromKey));
        }
        if ($source === [] || (string) $source[0]->storage_key !== $fromKey) {
            return $this->recordCreate($toKey);
        }
        // An overwritten destination was deleted by the COPY first.
        if ($this->liveByKey($toKey) !== null) {
            $this->recordDelete($toKey);
        }
        $parent = $this->ensureParentIndexed($toKey);
        $seq = $this->nextSeq();
        $now = now();
        $idMap = [];
        $rows = [];
        $pending = [];
        foreach ($source as $row) {
            $sourceKey = (string) $row->storage_key;
            $newId = $this->mintNodeId();
            $idMap[(string) $row->node_id] = $newId;
            $destKey = $sourceKey === $fromKey ? $toKey : $toKey.substr($sourceKey, strlen($fromKey));
            $rows[] = [
                'node_id' => $newId,
                'storage_key' => $destKey,
                'parent_node_id' => $sourceKey === $fromKey
                    ? $parent?->node_id
                    : ($idMap[(string) $row->parent_node_id] ?? null),
                'name' => basename($destKey),
                'is_dir' => (bool) $row->is_dir,
                'size_bytes' => $row->size_bytes,
                'content_sha256' => $row->content_sha256,
                'hash_pending' => (bool) $row->hash_pending,
                'created_seq' => $seq,
                'change_seq' => $seq,
                'created_at' => $now,
                'updated_at' => $now,
            ];
            if ((bool) $row->hash_pending) {
                $pending[] = $destKey;
            }
        }
        // ~13 bound values per row: stay under SQLite's variable limit.
        foreach (array_chunk($rows, 500) as $chunk) {
            JmapFileNode::query()->insert($chunk);
        }
        foreach ($pending as $destKey) {
            $node = $this->liveByKey($destKey);
            if ($node !== null) {
                $this->hasher->markPending($node);
            }
        }
        $this->markers->touch($toKey, withDescendantShares: true);
        foreach ($rows as $row) {
            $this->syncSearch($row['storage_key']);
        }

        return $this->liveByKey($toKey);
    }

    /**
     * Re-keys the subtree while keeping every node_id — id stability across
     * rename/move. Only the moved node itself gets a change_seq bump
     * (descendants keep their ids AND their seq: their parent link is by id,
     * so nothing about them changed).
     */
    public function recordMove(string $fromKey, string $toKey): ?JmapFileNode
    {
        return $this->markers->batch(fn (): ?JmapFileNode => $this->moveNode($fromKey, $toKey));
    }

    private function moveNode(string $fromKey, string $toKey): ?JmapFileNode
    {
        if ($this->isHiddenKey($fromKey)) {
            $this->syncSearch($fromKey, deleted: true);

            return $this->isHiddenKey($toKey) ? null : $this->recordCreate($toKey);
        }
        if ($this->isHiddenKey($toKey)) {
            $this->recordDelete($fromKey);

            return null;
        }
        $row = $this->liveByKey($fromKey);
        if ($row === null) {
            $this->syncSearch($fromKey, deleted: true);

            return $this->recordCreate($toKey);
        }

        $newParent = $this->ensureParentIndexed($toKey);

        $fromPrefix = $fromKey.'/';
        $descendants = JmapFileNode::query()
            ->whereNull('deleted_at')
            ->whereRaw("storage_key LIKE ? ESCAPE '!'", [$this->escapeLike($fromPrefix).'%'])
            ->get();
        foreach ($descendants as $descendant) {
            if (! str_starts_with((string) $descendant->storage_key, $fromPrefix)) {
                continue;
            }
            $descendant->storage_key = $toKey.'/'.substr((string) $descendant->storage_key, strlen($fromPrefix));
            $descendant->save();
        }

        $isDir = (bool) $row->is_dir;
        $row->storage_key = $toKey;
        $row->name = basename($toKey);
        $row->parent_node_id = $newParent?->node_id;
        $row->change_seq = $this->nextSeq();
        $row->save();
        // Old and new root sets, including share roots inside a moved folder.
        $this->markers->touch($fromKey, withDescendantShares: true);
        $this->markers->touch($toKey, withDescendantShares: true);

        $this->syncSearch($fromKey, deleted: true);
        $this->syncSearch($toKey);
        if ($isDir) {
            foreach ($this->liveSelfAndDescendants($toKey) as $descendant) {
                $key = (string) $descendant->storage_key;
                if ($key !== $toKey) {
                    $this->syncSearch($key);
                }
            }
        }

        return $row;
    }

    public function recordDelete(string $key): void
    {
        $this->markers->batch(fn () => $this->deleteNode($key));
    }

    private function deleteNode(string $key): void
    {
        $row = $this->liveByKey($key);
        if ($row === null) {
            $this->syncSearch($key, deleted: true);

            return;
        }

        $keys = JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where(function ($query) use ($key, $row): void {
                $query->whereRaw("storage_key LIKE ? ESCAPE '!'", [$this->escapeLike($key.'/').'%'])
                    ->orWhere('node_id', $row->node_id);
            })
            ->get();
        foreach ($keys as $node) {
            if ((string) $node->node_id !== (string) $row->node_id && ! str_starts_with((string) $node->storage_key, $key.'/')) {
                continue;
            }
            $node->deleted_at = now();
            $node->change_seq = $this->nextSeq();
            $node->save();
        }
        $this->markers->touch($key, withDescendantShares: true);
        $this->syncSearch($key, deleted: true);
    }

    /**
     * Document move on a write route: the Yjs sidecar follows the bytes,
     * including a rename inside the same principal. Reindex and attachment
     * folder moves stay on {@see recordMove} so they do not touch sidecars.
     */
    public function recordMoveWithSidecar(string $fromKey, string $toKey): ?JmapFileNode
    {
        $this->sidecars->moveWithDocument($fromKey, $toKey);
        $this->sidecarLinks->moveWithDocument($fromKey, $toKey);

        return $this->recordMove($fromKey, $toKey);
    }

    /**
     * #1517: before a FileNode/set content write. Like a WebDAV PUT, it is an
     * outside write to a Docs document, detected on the next yjs read.
     */
    public function recordBeforeContentWrite(string $key): void
    {
        $this->sidecarLinks->recordBeforeExternalWrite($key);
    }

    /**
     * #1517: a file replacing a document at the same path keeps the Docs
     * state there. Runs the destroy, then puts the sidecar and row back.
     */
    public function replaceKeepingDocsState(string $key, callable $destroy): void
    {
        $held = $this->sidecarLinks->holdForReplace($key);
        $destroy();
        if ($held !== null) {
            $this->sidecarLinks->restoreAfterReplace($key, $held);
        }
    }

    /**
     * Document delete on a write route. {@see recordDelete} stays sidecar-free
     * so a reindex of an already-missing file leaves an orphan sidecar in place.
     */
    public function recordDeleteWithSidecar(string $key): void
    {
        $this->sidecars->deleteWithDocument($key);
        $this->sidecarLinks->deleteWithDocument($key);
        $this->recordDelete($key);
    }

    // ---------------------------------------------------------------
    // Reconciliation (lazy self-heal + backfill)

    /**
     * Makes sure the account's root nodes exist, then reconciles the given
     * directory's direct children against the disk. Minted rows appear as
     * created in /changes (correct: newly discovered), vanished rows are
     * tombstoned.
     *
     * @param  list<string>  $groupSlugs
     */
    public function ensureRootsIndexed(string $username, array $groupSlugs): void
    {
        $this->markers->batch(fn () => $this->indexMissingRoots($username, $groupSlugs));
    }

    /**
     * @param  list<string>  $groupSlugs
     */
    private function indexMissingRoots(string $username, array $groupSlugs): void
    {
        foreach ($this->visibleRoots($username, $groupSlugs) as $root) {
            if ($this->liveByKey($root) !== null) {
                continue;
            }
            $disk = $this->storage->files();
            if (! $disk->directoryExists($root)) {
                // Personal homes are created lazily on first DAV access;
                // mirror that here so the root node always exists.
                if (str_starts_with($root, 'users/')) {
                    $disk->makeDirectory($root);
                } else {
                    continue;
                }
            }
            $seq = $this->nextSeq();
            $this->markers->touch($root);
            JmapFileNode::query()->create([
                'node_id' => $this->mintNodeId(),
                'storage_key' => $root,
                'parent_node_id' => null,
                'name' => basename($root),
                'is_dir' => true,
                'created_seq' => $seq,
                'change_seq' => $seq,
            ]);
        }
    }

    public function reconcileDirectory(string $dirKey): void
    {
        $this->markers->batch(fn () => $this->reconcileChildren($dirKey));
    }

    private function reconcileChildren(string $dirKey): void
    {
        $dirNode = $this->liveByKey($dirKey);
        if ($dirNode === null || ! $dirNode->is_dir) {
            return;
        }

        $disk = $this->storage->files();
        $onDisk = [];
        foreach ($disk->directories($dirKey) as $childKey) {
            $onDisk[$childKey] = true;
        }
        foreach ($disk->files($dirKey) as $childKey) {
            $onDisk[$childKey] = false;
        }

        foreach ($onDisk as $childKey => $isDir) {
            if ($this->isHiddenKey((string) $childKey)) {
                continue;
            }
            if ($this->liveByKey((string) $childKey) === null) {
                $this->recordCreate((string) $childKey);
            }
        }

        foreach ($this->liveChildren((string) $dirNode->node_id) as $child) {
            if (! array_key_exists((string) $child->storage_key, $onDisk)) {
                $this->recordDelete((string) $child->storage_key);
            }
        }
    }

    public function pruneTombstones(int $retentionDays): int
    {
        $cutoff = now()->subDays(max(1, $retentionDays));
        $stale = JmapFileNode::query()
            ->whereNotNull('deleted_at')
            ->where('deleted_at', '<', $cutoff)
            ->get();
        if ($stale->isEmpty()) {
            return 0;
        }

        $maxSeq = (int) $stale->max('change_seq');
        $meta = $this->meta();
        if ($maxSeq > (int) $meta->pruned_seq) {
            $meta->pruned_seq = $maxSeq;
            $meta->save();
        }
        JmapFileNode::query()->whereIn('id', $stale->pluck('id'))->delete();

        return $stale->count();
    }

    // ---------------------------------------------------------------
    // Changes

    /**
     * @param  list<string>  $roots
     * @return array{created: list<string>, updated: list<string>, destroyed: list<string>}|null
     *                                                                                           null when the sinceState predates the pruning horizon or the
     *                                                                                           counter (cannotCalculateChanges).
     */
    public function changesSince(int $since, array $roots): ?array
    {
        if ($since < $this->prunedSeq() || $since > $this->currentSeq()) {
            return null;
        }

        $rows = JmapFileNode::query()
            ->where('change_seq', '>', $since)
            ->orderBy('change_seq')
            ->get();

        $created = [];
        $updated = [];
        $destroyed = [];
        foreach ($rows as $row) {
            if (! $this->isVisibleKey((string) $row->storage_key, $roots)) {
                continue;
            }
            $nodeId = (string) $row->node_id;
            if ($row->deleted_at !== null) {
                // Created and destroyed within the window → omit (RFC 8620 §5.2).
                if ((int) $row->created_seq > $since) {
                    continue;
                }
                $destroyed[] = $nodeId;
            } elseif ((int) $row->created_seq > $since) {
                $created[] = $nodeId;
            } else {
                $updated[] = $nodeId;
            }
        }

        return [
            'created' => array_values(array_unique($created)),
            'updated' => array_values(array_unique($updated)),
            'destroyed' => array_values(array_unique($destroyed)),
        ];
    }

    // ---------------------------------------------------------------
    // Helpers

    /**
     * Live row at $key plus live descendants, parents before children.
     * `!` is the LIKE escape: portable to SQLite (no default escape) and
     * MySQL (a backslash ESCAPE clause is a syntax error there).
     *
     * @return list<JmapFileNode>
     */
    private function liveSubtree(string $key): array
    {
        $pattern = $this->escapeLike($key).'/%';

        // LIKE ignores case on SQLite and on _ci collations: keep only the
        // exact key and keys under "$key/" by byte comparison.
        return array_values(JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where(function ($query) use ($key, $pattern): void {
                $query->where('storage_key', $key)
                    ->orWhereRaw("storage_key LIKE ? ESCAPE '!'", [$pattern]);
            })
            ->orderBy('storage_key')
            ->get()
            ->filter(static fn (JmapFileNode $row): bool => (string) $row->storage_key === $key
                || str_starts_with((string) $row->storage_key, $key.'/'))
            ->all());
    }

    private function ensureParentIndexed(string $key): ?JmapFileNode
    {
        $parentKey = dirname($key);
        if ($parentKey === '.' || $parentKey === '' || $parentKey === '/') {
            return null;
        }
        $parent = $this->liveByKey($parentKey);
        if ($parent !== null) {
            return $parent;
        }
        // Walk upward: mint missing ancestors (bounded by path depth).
        if (! $this->isRootedKey($parentKey)) {
            return null;
        }
        if ($this->storage->files()->directoryExists($parentKey)) {
            $grand = $this->ensureParentIndexed($parentKey);
            $seq = $this->nextSeq();
            $this->markers->touch($parentKey);

            return JmapFileNode::query()->create([
                'node_id' => $this->mintNodeId(),
                'storage_key' => $parentKey,
                'parent_node_id' => $grand?->node_id,
                'name' => basename($parentKey),
                'is_dir' => true,
                'created_seq' => $seq,
                'change_seq' => $seq,
            ]);
        }

        return null;
    }

    /**
     * Keys outside users/... and groups/... (e.g. temp areas) are never nodes.
     */
    private function isRootedKey(string $key): bool
    {
        if (preg_match('#^(users|groups)/[^/]+#', $key) !== 1) {
            return false;
        }

        return true;
    }

    private function mintNodeId(): string
    {
        return 'fn-'.Str::lower(Str::replace('-', '', Str::uuid()->toString()));
    }

    private function escapeLike(string $value): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value);
    }
}
