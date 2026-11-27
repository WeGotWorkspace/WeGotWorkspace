<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Storage\ProjectArchivePaths;
use Illuminate\Database\Eloquent\Builder;

/**
 * The live nodes under an account's visible roots, as SQL (#2063): the scope of an
 * unfiltered FileNode/query, and its keyset page. The archived Project tree is left
 * out in SQL too, so a keyset page is short only at the end of the walk.
 */
final class FileNodeTreeScope
{
    /**
     * One keyset page of live node ids: ascending `node_id` after `$idAfter`, only nodes
     * created at or before `$asOfSeq`. Loads the id column only.
     *
     * @param  list<string>  $roots
     * @return list<string>
     */
    public function idsAfter(array $roots, ?string $idAfter, ?int $asOfSeq, ?int $limit): array
    {
        $query = $this->scope($roots, $asOfSeq);
        if ($idAfter !== null) {
            $query->where('node_id', '>', $idAfter);
        }
        $query->orderBy('node_id');
        if ($limit !== null) {
            $query->limit($limit);
        }

        return array_values(array_map(strval(...), $query->pluck('node_id')->all()));
    }

    /**
     * How many ids the whole keyset walk returns.
     *
     * @param  list<string>  $roots
     */
    public function count(array $roots, ?int $asOfSeq): int
    {
        return $this->scope($roots, $asOfSeq)->count();
    }

    /**
     * Narrows `$query` to the rows at or under one of `$roots` (storage-key prefix).
     *
     * @param  Builder<JmapFileNode>  $query
     * @param  list<string>  $roots
     */
    public static function underRoots(Builder $query, array $roots): void
    {
        $query->where(static function (Builder $outer) use ($roots): void {
            foreach ($roots as $root) {
                $outer->orWhere('storage_key', $root)
                    ->orWhereRaw("storage_key LIKE ? ESCAPE '!'", [self::escapeLike($root).'/%']);
            }
        });
    }

    /**
     * @param  list<string>  $roots
     * @return Builder<JmapFileNode>
     */
    private function scope(array $roots, ?int $asOfSeq): Builder
    {
        $query = JmapFileNode::query()->whereNull('deleted_at');
        $roots = array_values(array_filter($roots, static fn (string $root): bool => ! ProjectArchivePaths::isUnder($root)));
        if ($roots === []) {
            return $query->whereRaw('1 = 0');
        }
        self::underRoots($query, $roots);
        foreach ($roots as $root) {
            // Only a Team root (`groups/{slug}`) holds an archived Project tree.
            if (preg_match('#^groups/[^/]+$#', $root) !== 1) {
                continue;
            }
            $archive = $root.'/'.ProjectArchivePaths::DIR;
            $query->where('storage_key', '!=', $archive)
                ->whereRaw("storage_key NOT LIKE ? ESCAPE '!'", [self::escapeLike($archive).'/%']);
        }
        if ($asOfSeq !== null) {
            $query->where('created_seq', '<=', $asOfSeq);
        }

        return $query;
    }

    private static function escapeLike(string $value): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value);
    }
}
