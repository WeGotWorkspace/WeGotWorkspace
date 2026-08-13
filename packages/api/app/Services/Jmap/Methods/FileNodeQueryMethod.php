<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * FileNode/query (draft-ietf-jmap-filenode-14 §3.2.5) over the node index.
 *
 * Honest subset (the contacts precedent): supported filter conditions are
 * isTopLevel, parentId, ancestorId, nodeType, name, nameMatch; supported
 * sorts are name and nodeType (directories first); the draft's `depth`
 * argument recurses below a parentId filter. Everything else →
 * unsupportedFilter / unsupportedSort instead of silently wrong results.
 */
final class FileNodeQueryMethod implements JmapMethodInterface
{
    private const SUPPORTED_FILTER_CONDITIONS = ['isTopLevel', 'parentId', 'ancestorId', 'nodeType', 'name', 'nameMatch'];

    private const SUPPORTED_SORT_PROPERTIES = ['name', 'nodeType'];

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeAccountSupport $accounts,
    ) {}

    public function name(): string
    {
        return 'FileNode/query';
    }

    public function capability(): string
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
        if ($filter === null) {
            $filter = [];
        }
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
        if ($sort === null) {
            $sort = [];
        }
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

        $roots = $this->accounts->rootsFor($username);
        $candidates = $this->candidates($username, $filter, $roots, $depth ?? 0);

        $candidates = array_values(array_filter(
            $candidates,
            fn (JmapFileNode $node): bool => $this->matches($node, $filter),
        ));

        $this->sortNodes($candidates, $sort);

        $ids = array_map(static fn (JmapFileNode $node): string => (string) $node->node_id, $candidates);

        $response = [
            'accountId' => $username,
            'queryState' => (string) $this->index->currentSeq(),
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
     * Structural narrowing + lazy reconciliation of the directories the
     * query touches (design decision 3).
     *
     * @param  array<string, mixed>  $filter
     * @param  list<string>  $roots
     * @return list<JmapFileNode>
     */
    private function candidates(string $username, array $filter, array $roots, int $depth): array
    {
        $this->accounts->ensureAccountIndexed($username);

        if (($filter['isTopLevel'] ?? null) === true) {
            $nodes = [];
            foreach ($roots as $root) {
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

        // Unfiltered (or attribute-only) query: the whole visible set.
        $this->accounts->reconcileVisibleTree($username);

        return $this->index->liveVisible($roots);
    }

    /**
     * Direct children plus `depth` further levels of recursion (§3.2.5).
     *
     * @return list<JmapFileNode>
     */
    private function descendantsOf(JmapFileNode $parent, int $depth): array
    {
        $this->index->reconcileDirectory((string) $parent->storage_key);

        $result = [];
        $frontier = [[$parent, 0]];
        while ($frontier !== []) {
            [$dir, $level] = array_shift($frontier);
            foreach ($this->index->liveChildren((string) $dir->node_id) as $child) {
                $result[] = $child;
                if ($child->is_dir && $level < $depth) {
                    $this->index->reconcileDirectory((string) $child->storage_key);
                    $frontier[] = [$child, $level + 1];
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
