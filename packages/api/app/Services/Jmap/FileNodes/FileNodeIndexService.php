<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Models\JmapFileNodeMeta;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The FileNode node-identity index (#450, design: docs/files/jmap-filenode-design.md):
 * stable `fn-` ids over the path-addressed drive, with a global monotonic
 * change sequence and tombstones powering FileNode/changes. Maintained
 * best-effort from both write paths (DriveService and the DAV
 * FileNodeIndexPlugin) and reconciled lazily on reads plus via the
 * wgw:jmap:filenodes-reindex command — out-of-band writes are expected,
 * not fatal (an out-of-band rename is indistinguishable from delete+create
 * and changes the node id; documented deviation).
 */
final class FileNodeIndexService
{
    /** Dot-prefixed segments are internal (collab sidecars, AppleDouble) unless product-excepted. */
    private const HIDDEN_SEGMENT_PREFIX = '.';

    /** Product trash is hidden from browse listings but is a FileNode. */
    private const PRODUCT_TRASH_DIR = '.Trash';

    /** Product notes tree is hidden from Drive browse but is a FileNode. */
    private const PRODUCT_NOTES_DIR = '.notes';

    /** `.archive` is a FileNode only when it lives under `.notes`. */
    private const PRODUCT_NOTES_ARCHIVE_DIR = '.archive';

    public function __construct(private readonly WgwStorage $storage) {}

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
     * Storage-key prefixes visible to an account: the personal tree plus
     * member group trees (design decision 5 — shared-with-me deferred).
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
        $underNotes = false;
        foreach (explode('/', $key) as $segment) {
            if ($segment === '') {
                continue;
            }
            if ($this->isIndexedDotSegment($segment, $underNotes)) {
                if ($segment === self::PRODUCT_NOTES_DIR) {
                    $underNotes = true;
                }

                continue;
            }
            if (str_starts_with($segment, self::HIDDEN_SEGMENT_PREFIX)) {
                return true;
            }
        }

        return false;
    }

    private function isIndexedDotSegment(string $segment, bool $underNotes): bool
    {
        return $segment === self::PRODUCT_TRASH_DIR
            || $segment === self::PRODUCT_NOTES_DIR
            || ($segment === self::PRODUCT_NOTES_ARCHIVE_DIR && $underNotes);
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
        return JmapFileNode::query()
            ->where('parent_node_id', $parentNodeId)
            ->whereNull('deleted_at')
            ->orderBy('storage_key')
            ->get()
            ->all();
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
                    ->orWhere('storage_key', 'like', $this->escapeLike($root).'/%');
            }
        });

        return $query->orderBy('storage_key')->get()->all();
    }

    // ---------------------------------------------------------------
    // Recording (called from DriveService, the DAV plugin, and FileNode/set)

    public function recordCreate(string $key): ?JmapFileNode
    {
        if ($this->isHiddenKey($key)) {
            return null;
        }
        $existing = $this->liveByKey($key);
        if ($existing !== null) {
            return $this->recordContentWrite($key) ?? $existing;
        }

        $parent = $this->ensureParentIndexed($key);
        $disk = $this->storage->files();
        $isDir = $disk->directoryExists($key);
        if (! $isDir && ! $disk->fileExists($key)) {
            return null;
        }

        $seq = $this->nextSeq();

        return JmapFileNode::query()->create([
            'node_id' => $this->mintNodeId(),
            'storage_key' => $key,
            'parent_node_id' => $parent?->node_id,
            'name' => basename($key),
            'is_dir' => $isDir,
            'size_bytes' => $isDir ? null : (int) ($disk->size($key) ?: 0),
            'content_sha256' => null,
            'created_seq' => $seq,
            'change_seq' => $seq,
        ]);
    }

    public function recordContentWrite(string $key, ?string $sha256 = null): ?JmapFileNode
    {
        if ($this->isHiddenKey($key)) {
            return null;
        }
        $row = $this->liveByKey($key);
        if ($row === null) {
            $row = $this->recordCreate($key);
            if ($row !== null && ! $row->is_dir && $sha256 !== null) {
                // Fresh row: attach the known content hash without another
                // seq bump (the create already announced the node).
                $row->content_sha256 = $sha256;
                $row->saveQuietly();
            }

            return $row;
        }

        $disk = $this->storage->files();
        $row->size_bytes = $row->is_dir ? null : (int) ($disk->size($key) ?: 0);
        $row->content_sha256 = $row->is_dir ? null : $sha256;
        $row->change_seq = $this->nextSeq();
        $row->save();

        return $row;
    }

    /**
     * Re-keys the subtree while keeping every node_id — id stability across
     * rename/move. Only the moved node itself gets a change_seq bump
     * (descendants keep their ids AND their seq: their parent link is by id,
     * so nothing about them changed).
     */
    public function recordMove(string $fromKey, string $toKey): ?JmapFileNode
    {
        if ($this->isHiddenKey($fromKey) || $this->isHiddenKey($toKey)) {
            return null;
        }
        $row = $this->liveByKey($fromKey);
        if ($row === null) {
            return $this->recordCreate($toKey);
        }

        $newParent = $this->ensureParentIndexed($toKey);

        $fromPrefix = $fromKey.'/';
        $descendants = JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where('storage_key', 'like', $this->escapeLike($fromPrefix).'%')
            ->get();
        foreach ($descendants as $descendant) {
            $descendant->storage_key = $toKey.'/'.substr((string) $descendant->storage_key, strlen($fromPrefix));
            $descendant->save();
        }

        $row->storage_key = $toKey;
        $row->name = basename($toKey);
        $row->parent_node_id = $newParent?->node_id;
        $row->change_seq = $this->nextSeq();
        $row->save();

        return $row;
    }

    public function recordDelete(string $key): void
    {
        $row = $this->liveByKey($key);
        if ($row === null) {
            return;
        }

        $keys = JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where(function ($query) use ($key, $row): void {
                $query->where('storage_key', 'like', $this->escapeLike($key.'/').'%')
                    ->orWhere('node_id', $row->node_id);
            })
            ->get();
        foreach ($keys as $node) {
            $node->deleted_at = now();
            $node->change_seq = $this->nextSeq();
            $node->save();
        }
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

    /**
     * Full-tree backfill/reconcile (the reindexAll pattern). Existing keys
     * keep their node ids; new keys are minted; vanished keys tombstoned.
     * Also prunes tombstones older than the retention window.
     *
     * @return array{indexed: int, tombstoned: int, pruned: int}
     */
    public function reindexAll(int $tombstoneRetentionDays = 30): array
    {
        $disk = $this->storage->files();
        $indexed = 0;

        $seen = [];
        foreach ($disk->allDirectories() as $key) {
            if ($this->isHiddenKey($key) || ! $this->isRootedKey($key)) {
                continue;
            }
            $seen[$key] = true;
            if ($this->liveByKey($key) === null && $this->recordCreate($key) !== null) {
                $indexed++;
            }
        }
        foreach ($disk->allFiles() as $key) {
            if ($this->isHiddenKey($key) || ! $this->isRootedKey($key)) {
                continue;
            }
            $seen[$key] = true;
            if ($this->liveByKey($key) === null && $this->recordCreate($key) !== null) {
                $indexed++;
            }
        }

        $tombstoned = 0;
        JmapFileNode::query()->whereNull('deleted_at')->orderBy('id')
            ->chunk(500, function ($rows) use ($seen, $disk, &$tombstoned): void {
                foreach ($rows as $row) {
                    $key = (string) $row->storage_key;
                    if (isset($seen[$key])) {
                        continue;
                    }
                    if ($disk->directoryExists($key) || $disk->fileExists($key)) {
                        continue;
                    }
                    $this->recordDelete($key);
                    $tombstoned++;
                }
            });

        $pruned = $this->pruneTombstones($tombstoneRetentionDays);

        return ['indexed' => $indexed, 'tombstoned' => $tombstoned, 'pruned' => $pruned];
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
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $value);
    }
}
