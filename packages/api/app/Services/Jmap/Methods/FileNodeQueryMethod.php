<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeSyncState;
use App\Services\Jmap\FileNodes\FileNodeTags;
use App\Services\Jmap\FileNodes\FileNodeTreeScope;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\JmapRequestContext;
use App\Storage\ProjectArchivePaths;

/**
 * FileNode/query (draft-ietf-jmap-filenode-14 §3.2.5) over the node index.
 *
 * Honest subset (the contacts precedent): supported filter conditions are
 * isTopLevel, parentId, ancestorId, nodeType, name, nameMatch; supported
 * sorts are name and nodeType (directories first); the draft's `depth`
 * argument recurses below a parentId filter. Everything else →
 * unsupportedFilter / unsupportedSort instead of silently wrong results.
 *
 * With the WGW tree extension (#2063, {@see JmapCapabilities::FILENODE_TREE}) an
 * unfiltered query also pages by `node_id` keyset: `idAfter` and `asOfState` are
 * top-level arguments, so `#idAfter` can reference `/ids/499` of the previous page.
 */
final class FileNodeQueryMethod implements JmapMethodInterface
{
    private const SUPPORTED_FILTER_CONDITIONS = ['isTopLevel', 'parentId', 'ancestorId', 'nodeType', 'name', 'nameMatch', 'hasTag'];

    private const SUPPORTED_SORT_PROPERTIES = ['name', 'nodeType', 'id'];

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeAccountSupport $accounts,
        private readonly FileNodeSyncState $syncState,
        private readonly FileNodeTreeScope $tree,
        private readonly JmapRequestContext $context,
        private readonly FileNodeTags $tags = new FileNodeTags,
    ) {}

    public static function name(): string
    {
        return 'FileNode/query';
    }

    public static function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $filter = $args['filter'] ?? [];
        if (! is_array($filter) || ($filter !== [] && array_is_list($filter))) {
            throw new JmapMethodException('invalidArguments', 'filter must be null or a FilterCondition object.');
        }
        $unsupported = array_diff(array_keys($filter), self::SUPPORTED_FILTER_CONDITIONS);
        if ($unsupported !== []) {
            throw new JmapMethodException(
                'unsupportedFilter',
                'Unsupported filter conditions: '.implode(', ', array_map(strval(...), $unsupported)).'.',
            );
        }

        $sort = $args['sort'] ?? [];
        if (! is_array($sort) || ! array_is_list($sort)) {
            throw new JmapMethodException('invalidArguments', 'sort must be null or an array of comparators.');
        }
        foreach ($sort as $comparator) {
            $property = is_array($comparator) ? ($comparator['property'] ?? null) : null;
            if (! is_string($property) || ! in_array($property, self::SUPPORTED_SORT_PROPERTIES, true)) {
                throw new JmapMethodException('unsupportedSort', 'Supported sort properties: '.implode(', ', self::SUPPORTED_SORT_PROPERTIES).'.');
            }
        }

        $position = $args['position'] ?? 0;
        if (! is_int($position) || $position < 0) {
            throw new JmapMethodException('invalidArguments', 'position must be a non-negative integer.');
        }
        $limit = $args['limit'] ?? null;
        if ($limit !== null && (! is_int($limit) || $limit < 1)) {
            throw new JmapMethodException('invalidArguments', 'limit must be null or a positive integer.');
        }
        $depth = $args['depth'] ?? null;
        if ($depth !== null && (! is_int($depth) || $depth < 0)) {
            throw new JmapMethodException('invalidArguments', 'depth must be null or a non-negative integer.');
        }

        $roots = $this->accounts->ensureAccountIndexed($username);
        $keyset = $this->keysetArguments($args, $filter, $sort, $position);
        if ($keyset !== null) {
            return $this->keysetPage($username, $roots, $keyset, $limit, ($args['calculateTotal'] ?? false) === true);
        }
        $candidates = $this->candidates($username, $filter, $roots, $depth ?? 0);

        $tagged = null;
        if (array_key_exists('hasTag', $filter)) {
            if (! is_string($filter['hasTag']) || $filter['hasTag'] === '') {
                throw new JmapMethodException('invalidArguments', 'hasTag must be a non-empty string.');
            }
            $tagged = array_flip($this->tags->nodeIdsWithTag($filter['hasTag']));
        }

        $candidates = array_values(array_filter(
            $candidates,
            fn (JmapFileNode $node): bool => $this->matches($node, $filter)
                && ($tagged === null || (isset($tagged[(string) $node->node_id]) && ! $this->inTrash($node))),
        ));

        $this->sortNodes($candidates, $sort);

        $ids = array_map(static fn (JmapFileNode $node): string => (string) $node->node_id, $candidates);

        $response = [
            'accountId' => $username,
            'queryState' => $this->syncState->current($username),
            'canCalculateChanges' => false,
            'position' => $position,
            'ids' => array_slice($ids, $position, $limit),
            'total' => count($ids),
        ];
        if ($limit !== null) {
            $response['limit'] = $limit;
        }

        return $response;
    }

    /**
     * `idAfter` and `asOfState`, or null for a query that does not page by keyset. A keyset
     * page walks the whole visible tree in `node_id` order, so it takes no filter, no sort
     * other than `id` ascending, and no position.
     *
     * @param  array<string, mixed>  $args
     * @param  array<string, mixed>  $filter
     * @param  list<mixed>  $sort
     * @return array{idAfter: ?string, asOfSeq: ?int}|null
     */
    private function keysetArguments(array $args, array $filter, array $sort, int $position): ?array
    {
        if (! array_key_exists('idAfter', $args) && ! array_key_exists('asOfState', $args)) {
            return null;
        }
        if (! $this->context->uses(JmapCapabilities::FILENODE_TREE)) {
            throw new JmapMethodException('invalidArguments', 'idAfter and asOfState need '.JmapCapabilities::FILENODE_TREE.' in using.');
        }
        $idAfter = $args['idAfter'] ?? null;
        if ($idAfter !== null && (! is_string($idAfter) || $idAfter === '')) {
            throw new JmapMethodException('invalidArguments', 'idAfter must be null or a FileNode id.');
        }
        $asOfState = $args['asOfState'] ?? null;
        if ($asOfState !== null && ! is_string($asOfState)) {
            throw new JmapMethodException('invalidArguments', 'asOfState must be null or a FileNode state.');
        }
        if ($filter !== []) {
            throw new JmapMethodException('invalidArguments', 'idAfter and asOfState page the unfiltered tree; filter must be null.');
        }
        foreach ($sort as $comparator) {
            if (! is_array($comparator) || ($comparator['property'] ?? null) !== 'id' || ($comparator['isAscending'] ?? true) === false) {
                throw new JmapMethodException('unsupportedSort', 'A keyset page is sorted by id ascending.');
            }
        }
        if ($position !== 0) {
            throw new JmapMethodException('invalidArguments', 'A keyset page takes no position.');
        }

        return [
            'idAfter' => $idAfter,
            'asOfSeq' => $asOfState === null ? null : $this->syncState->seqOf($asOfState),
        ];
    }

    /**
     * One keyset page of the visible tree, in `node_id` order: one SQL query of ids
     * from the index, never a disk walk. Every write through the app already updates
     * the index; drift from writes past the app heals when that folder is listed
     * (a `parentId` query) or with `wgw:jmap:filenodes-reindex` (#2063).
     *
     * @param  list<string>  $roots
     * @param  array{idAfter: ?string, asOfSeq: ?int}  $keyset
     * @return array<string, mixed>
     */
    private function keysetPage(string $username, array $roots, array $keyset, ?int $limit, bool $calculateTotal): array
    {
        $response = [
            'accountId' => $username,
            'queryState' => $this->syncState->current($username),
            'canCalculateChanges' => false,
            'position' => 0,
            'ids' => $this->tree->idsAfter($roots, $keyset['idAfter'], $keyset['asOfSeq'], $limit),
        ];
        if ($calculateTotal) {
            $response['total'] = $this->tree->count($roots, $keyset['asOfSeq']);
        }
        if ($limit !== null) {
            $response['limit'] = $limit;
        }

        return $response;
    }

    /**
     * Structural narrowing + lazy reconciliation of the directories the
     * query touches (design decision 3).
     *
     * @param  array<string, mixed>  $filter
     * @param  list<string>  $roots
     * @return list<JmapFileNode>
     */
    private function candidates(string $username, array $filter, array $roots, int $depth): array
    {
        if (($filter['isTopLevel'] ?? null) === true) {
            $nodes = [];
            foreach ($this->accounts->accountRootsFor($username) as $root) {
                $node = $this->index->liveByKey($root);
                if ($node !== null) {
                    $nodes[] = $node;
                }
            }

            return $nodes;
        }

        $parentId = $filter['parentId'] ?? null;
        if (is_string($parentId) && $parentId !== '') {
            $parent = $this->accounts->visibleLiveNode($parentId, $roots);
            if ($parent === null || ! $parent->is_dir) {
                return [];
            }

            return $this->descendantsOf($parent, $depth);
        }

        $ancestorId = $filter['ancestorId'] ?? null;
        if (is_string($ancestorId) && $ancestorId !== '') {
            $ancestor = $this->accounts->visibleLiveNode($ancestorId, $roots);
            if ($ancestor === null || ! $ancestor->is_dir) {
                return [];
            }

            return $this->descendantsOf($ancestor, PHP_INT_MAX);
        }

        // Unfiltered (or attribute-only) query: the whole visible set, from the index alone.
        // Writes through the app keep it current; a parentId listing or get-all heals drift (#2063).
        // Only what the filter and the sort read: no hydration of whole rows (#2063).
        return $this->index->liveVisible($roots, ['node_id', 'parent_node_id', 'name', 'is_dir']);
    }

    /**
     * Direct children plus `depth` further levels of recursion (§3.2.5).
     *
     * @return list<JmapFileNode>
     */
    private function descendantsOf(JmapFileNode $parent, int $depth): array
    {
        $result = [];
        $frontier = [[$this->index->reconcileDirectory($parent), 0]];
        while ($frontier !== []) {
            [$children, $level] = array_shift($frontier);
            foreach ($children as $child) {
                if (ProjectArchivePaths::isUnder((string) $child->storage_key)) {
                    continue;
                }
                $result[] = $child;
                if ($child->is_dir && $level < $depth) {
                    $frontier[] = [$this->index->reconcileDirectory($child), $level + 1];
                }
            }
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $filter
     */
    private function matches(JmapFileNode $node, array $filter): bool
    {
        if (($filter['isTopLevel'] ?? null) === false && $node->parent_node_id === null) {
            return false;
        }

        $nodeType = $filter['nodeType'] ?? null;
        if (is_string($nodeType) && $nodeType !== ($node->is_dir ? 'directory' : 'file')) {
            return false;
        }

        $name = $filter['name'] ?? null;
        if (is_string($name) && (string) $node->name !== $name) {
            return false;
        }

        $nameMatch = $filter['nameMatch'] ?? null;
        if (is_string($nameMatch) && ! fnmatch(mb_strtolower($nameMatch), mb_strtolower((string) $node->name))) {
            return false;
        }

        return true;
    }

    /** A tag view leaves trashed nodes out (the tags stay for a restore). */
    private function inTrash(JmapFileNode $node): bool
    {
        return preg_match('#(?:^|/)\.Trash(?:/|$)#', (string) $node->storage_key) === 1;
    }

    /**
     * @param  list<JmapFileNode>  $nodes
     * @param  list<mixed>  $sort
     */
    private function sortNodes(array &$nodes, array $sort): void
    {
        $comparators = $sort === [] ? [['property' => 'name', 'isAscending' => true]] : $sort;

        usort($nodes, static function (JmapFileNode $a, JmapFileNode $b) use ($comparators): int {
            foreach ($comparators as $comparator) {
                $property = is_array($comparator) ? (string) ($comparator['property'] ?? 'name') : 'name';
                $ascending = ! is_array($comparator) || ($comparator['isAscending'] ?? true) !== false;
                $result = match ($property) {
                    // Directories sort before files (§3.2.5 nodeType sort).
                    'nodeType' => ((int) $b->is_dir) <=> ((int) $a->is_dir),
                    'id' => strcmp((string) $a->node_id, (string) $b->node_id),
                    default => strcasecmp((string) $a->name, (string) $b->name),
                };
                if ($result !== 0) {
                    return $ascending ? $result : -$result;
                }
            }

            return strcmp((string) $a->storage_key, (string) $b->storage_key);
        });
    }
}
