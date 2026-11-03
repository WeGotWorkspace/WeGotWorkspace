<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\DriveShare;
use App\Models\JmapFileNodeRootMarker;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * A change counter per Drive root, for the `FileNode` push state (#1660,
 * docs/architecture/jmap-push.md "Drive: a change marker per root").
 *
 * A write bumps the roots its storage key falls under: the account root
 * (`users/x`, `groups/y`) and every share root that is the key itself or an
 * ancestor of it (found by looking up the key's ancestor paths, O(depth)).
 * A move or delete of a folder also bumps share roots inside it, so a grantee
 * of a sub-share sees it go. One upsert per root, not one per person with
 * access.
 *
 * Bound as a scoped singleton: {@see batch()} collects the roots of every
 * touch inside it and bumps each root once when the outermost batch ends.
 * A touch outside a batch bumps at once. A failed bump is logged, never
 * thrown: push is an accelerator and must not fail the Drive write.
 */
final class FileNodeRootMarkers
{
    private int $depth = 0;

    /** @var array<string, true> */
    private array $pending = [];

    /**
     * @template T
     *
     * @param  callable(): T  $operation
     * @return T
     */
    public function batch(callable $operation): mixed
    {
        $this->depth++;
        try {
            return $operation();
        } finally {
            $this->depth--;
            if ($this->depth === 0) {
                $this->flush();
            }
        }
    }

    /**
     * Records a write at `$key`. With `$withDescendantShares`, share roots
     * below the key count too (folder move and delete).
     */
    public function touch(string $key, bool $withDescendantShares = false): void
    {
        try {
            foreach ($this->rootsForKey($key, $withDescendantShares) as $root) {
                $this->pending[$root] = true;
            }
        } catch (\Throwable $e) {
            Log::warning('file_node_root_marker_lookup_failed', ['key' => $key, 'error' => $e->getMessage()]);
        }
        if ($this->depth === 0) {
            $this->flush();
        }
    }

    /**
     * Markers for the given roots; a root without a row is 0.
     *
     * @param  list<string>  $roots
     * @return array<string, int>
     */
    public function markersFor(array $roots): array
    {
        $markers = [];
        $byHash = [];
        foreach ($roots as $root) {
            $markers[$root] = 0;
            $byHash[self::hashRoot($root)] = $root;
        }
        if ($byHash === []) {
            return [];
        }
        $rows = JmapFileNodeRootMarker::query()
            ->whereIn('root_hash', array_keys($byHash))
            ->get(['root_hash', 'marker']);
        foreach ($rows as $row) {
            $root = $byHash[(string) $row->root_hash] ?? null;
            if ($root !== null) {
                $markers[$root] = (int) $row->marker;
            }
        }

        return $markers;
    }

    /**
     * The account root plus every live share root at or above `$key`
     * (and, on request, below it). Keys outside `users/` and `groups/` have
     * no root.
     *
     * @return list<string>
     */
    public function rootsForKey(string $key, bool $withDescendantShares = false): array
    {
        $key = trim($key, '/');
        if (preg_match('#^(?:users|groups)/[^/]+#', $key, $match) !== 1) {
            return [];
        }
        $roots = [$match[0] => true];

        $segments = explode('/', $key);
        $ancestors = [];
        for ($length = 3; $length <= count($segments); $length++) {
            $ancestors[] = '/'.implode('/', array_slice($segments, 0, $length));
        }
        if ($ancestors !== []) {
            $paths = DriveShare::query()
                ->whereIn('path', $ancestors)
                ->whereNull('revoked_at')
                ->pluck('path');
            foreach ($paths as $path) {
                $roots[ltrim((string) $path, '/')] = true;
            }
        }

        if ($withDescendantShares) {
            $prefix = '/'.$key.'/';
            // LIKE is a coarse filter (`_` and `%` match too); str_starts_with decides.
            $paths = DriveShare::query()
                ->where('path', 'like', $prefix.'%')
                ->whereNull('revoked_at')
                ->pluck('path');
            foreach ($paths as $path) {
                if (str_starts_with((string) $path, $prefix)) {
                    $roots[ltrim((string) $path, '/')] = true;
                }
            }
        }

        return array_keys($roots);
    }

    private function flush(): void
    {
        if ($this->pending === []) {
            return;
        }
        $roots = array_keys($this->pending);
        $this->pending = [];
        sort($roots, SORT_STRING);

        $rows = [];
        foreach ($roots as $root) {
            $rows[] = ['root_hash' => self::hashRoot($root), 'root_key' => $root, 'marker' => 1];
        }
        try {
            // One statement; an existing row counts up, a new row starts at 1.
            JmapFileNodeRootMarker::query()->upsert($rows, ['root_hash'], ['marker' => DB::raw('marker + 1')]);
        } catch (\Throwable $e) {
            Log::warning('file_node_root_marker_bump_failed', ['roots' => count($roots), 'error' => $e->getMessage()]);
        }
    }

    private static function hashRoot(string $root): string
    {
        return hash('sha256', $root);
    }
}
