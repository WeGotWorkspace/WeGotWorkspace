<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Models\JmapFileNodeTag;

/**
 * Tags on file nodes (#2402). Same rules as Notes tags: lowercase letters a-z
 * and hyphen, at most 255 characters. A tag is a string on a node, not an
 * entity. Rows are keyed by node id; who sees a tag is decided by who sees the
 * node, so Team files show the Team's tags and personal files the owner's.
 */
final class FileNodeTags
{
    public const MAX_LENGTH = 255;

    /** Most tags one node can carry. */
    public const MAX_PER_NODE = 64;

    public static function normalize(string $tag): string
    {
        return mb_strtolower(trim($tag));
    }

    public static function isValidNew(string $tag): bool
    {
        $normalized = self::normalize($tag);

        return $normalized !== ''
            && strlen($normalized) <= self::MAX_LENGTH
            && preg_match('/^[a-z-]+$/', $normalized) === 1;
    }

    /**
     * Parses `tagsAdd` / `tagsRemove` from an update patch. Null when neither
     * is present.
     *
     * @param  array<string, mixed>  $patch
     * @return array{add: list<string>, remove: list<string>}|null
     *
     * @throws FileNodeSetError invalidProperties for a malformed or invalid tag
     */
    public function patch(array $patch): ?array
    {
        if (! array_key_exists('tagsAdd', $patch) && ! array_key_exists('tagsRemove', $patch)) {
            return null;
        }
        $add = $this->list($patch['tagsAdd'] ?? [], 'tagsAdd');
        $remove = $this->list($patch['tagsRemove'] ?? [], 'tagsRemove');
        foreach ($add as $tag) {
            if (! self::isValidNew($tag)) {
                throw new FileNodeSetError([
                    'type' => 'invalidProperties',
                    'description' => 'A tag may only contain the letters a-z and a hyphen, up to '.self::MAX_LENGTH.' characters.',
                    'properties' => ['tagsAdd'],
                ]);
            }
        }

        return ['add' => $add, 'remove' => $remove];
    }

    /**
     * @return list<string>
     */
    private function list(mixed $value, string $property): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => $property.' must be an array of strings.', 'properties' => [$property]]);
        }
        $out = [];
        foreach ($value as $tag) {
            if (! is_string($tag)) {
                throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => $property.' must be an array of strings.', 'properties' => [$property]]);
            }
            $normalized = self::normalize($tag);
            if ($normalized !== '' && ! in_array($normalized, $out, true)) {
                $out[] = $normalized;
            }
        }

        return $out;
    }

    /**
     * Applies a delta. Removing runs first, so a tag in both lists ends added.
     *
     * @param  list<string>  $add
     * @param  list<string>  $remove
     * @return list<string> the node's tags after the change
     *
     * @throws FileNodeSetError when the node would exceed the tag limit
     */
    public function apply(string $nodeId, array $add, array $remove): array
    {
        $this->assertFits($nodeId, $add, $remove);
        if ($remove !== []) {
            JmapFileNodeTag::query()->where('node_id', $nodeId)->whereIn('tag', $remove)->delete();
        }
        $missing = array_values(array_diff($add, $this->forNode($nodeId)));
        if ($missing !== []) {
            // insertOrIgnore: a concurrent add of the same tag is not an error.
            JmapFileNodeTag::query()->insertOrIgnore(array_map(
                static fn (string $tag): array => ['node_id' => $nodeId, 'tag' => $tag],
                $missing,
            ));
        }

        return $this->forNode($nodeId);
    }

    /**
     * Checks the tag limit on the projected set (remove, then add) without
     * changing anything, so callers can refuse before any other mutation.
     *
     * @param  list<string>  $add
     * @param  list<string>  $remove
     *
     * @throws FileNodeSetError tooLarge when the node would exceed the tag limit
     */
    public function assertFits(string $nodeId, array $add, array $remove): void
    {
        $projected = array_unique([...array_diff($this->forNode($nodeId), $remove), ...$add]);
        if (count($projected) > self::MAX_PER_NODE) {
            throw new FileNodeSetError(['type' => 'tooLarge', 'description' => 'A node can carry at most '.self::MAX_PER_NODE.' tags.']);
        }
    }

    /**
     * @return list<string>
     */
    public function forNode(string $nodeId): array
    {
        return $this->forNodes([$nodeId])[$nodeId] ?? [];
    }

    /**
     * @param  list<string>  $nodeIds
     * @return array<string, list<string>> node id => tags in alphabetical order
     */
    public function forNodes(array $nodeIds): array
    {
        $map = [];
        foreach (array_chunk($nodeIds, 500) as $chunk) {
            $rows = JmapFileNodeTag::query()->whereIn('node_id', $chunk)->orderBy('tag')->get(['node_id', 'tag']);
            foreach ($rows as $row) {
                $map[(string) $row->node_id][] = (string) $row->tag;
            }
        }

        return $map;
    }

    /**
     * @return list<string> ids of every node that carries the tag
     */
    public function nodeIdsWithTag(string $tag): array
    {
        $ids = [];
        foreach (JmapFileNodeTag::query()->where('tag', self::normalize($tag))->pluck('node_id') as $id) {
            $ids[] = (string) $id;
        }

        return $ids;
    }

    /**
     * Tags in use across the given nodes, with how many nodes carry each.
     *
     * @param  list<string>  $nodeIds
     * @return list<array{tag: string, count: int}>
     */
    public function countsFor(array $nodeIds): array
    {
        $counts = [];
        foreach (array_chunk($nodeIds, 500) as $chunk) {
            $rows = JmapFileNodeTag::query()->whereIn('node_id', $chunk)->get(['tag']);
            foreach ($rows as $row) {
                $counts[(string) $row->tag] = ($counts[(string) $row->tag] ?? 0) + 1;
            }
        }
        ksort($counts);

        return array_map(static fn (string $tag, int $count): array => ['tag' => $tag, 'count' => $count], array_keys($counts), array_values($counts));
    }

    /**
     * A copy carries the tags of its source.
     *
     * @param  array<string, string>  $idMap  source node id => new node id
     */
    public function copy(array $idMap): void
    {
        foreach (array_chunk(array_keys($idMap), 500) as $chunk) {
            $rows = JmapFileNodeTag::query()->whereIn('node_id', $chunk)->get(['node_id', 'tag']);
            $insert = [];
            foreach ($rows as $row) {
                $insert[] = ['node_id' => $idMap[(string) $row->node_id], 'tag' => (string) $row->tag];
            }
            foreach (array_chunk($insert, 500) as $part) {
                JmapFileNodeTag::query()->insert($part);
            }
        }
    }

    /**
     * @param  list<string>  $nodeIds
     * @return list<string> the node ids that had tag rows deleted
     */
    public function dropFor(array $nodeIds): array
    {
        $dropped = [];
        foreach (array_chunk($nodeIds, 500) as $chunk) {
            $query = JmapFileNodeTag::query()->whereIn('node_id', $chunk);
            foreach ($query->distinct()->pluck('node_id') as $id) {
                $dropped[] = (string) $id;
            }
            $query->delete();
        }

        return $dropped;
    }

    /**
     * The space a storage key lives in: `users/<name>` (personal) or `groups/<slug>` (a
     * Team). Tags belong to one space and never cross into another (#2402).
     */
    public static function spaceOf(string $storageKey): string
    {
        return implode('/', array_slice(explode('/', trim($storageKey, '/')), 0, 2));
    }

    public static function sameSpace(string $fromKey, string $toKey): bool
    {
        return self::spaceOf($fromKey) === self::spaceOf($toKey);
    }

    /**
     * A copy keeps the source's tags inside one space; into another space it gets none.
     *
     * @param  array<string, string>  $idMap  source node id => new node id
     */
    public function copyWithinSpace(string $fromKey, string $toKey, array $idMap): void
    {
        if (self::sameSpace($fromKey, $toKey)) {
            $this->copy($idMap);
        }
    }

    /**
     * A personal tag must not travel into a Team, nor the other way round: a move
     * across spaces removes the tags of the moved nodes. Descendants that lost tags
     * changed, so they get `$seq` and FileNode/changes reports them; the moved node
     * itself is stamped by the caller.
     *
     * @param  list<string>  $nodeIds
     */
    public function dropOnSpaceChange(string $fromKey, string $toKey, array $nodeIds, string $rootId, int $seq): void
    {
        if (self::sameSpace($fromKey, $toKey)) {
            return;
        }
        $descendants = array_values(array_diff($this->dropFor($nodeIds), [$rootId]));
        foreach (array_chunk($descendants, 500) as $chunk) {
            JmapFileNode::query()->whereIn('node_id', $chunk)->update(['change_seq' => $seq]);
        }
    }
}
