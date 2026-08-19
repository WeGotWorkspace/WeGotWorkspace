<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeMapper;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * FileNode/get (draft-ietf-jmap-filenode-14 §3.2.1) over the node-identity
 * index (#450). Get-all reconciles the visible tree first (lazy self-heal,
 * design decision 3); by-id reads the index directly. Supports the draft's
 * fetchParents argument.
 */
final class FileNodeGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeMapper $mapper,
        private readonly FileNodeAccountSupport $accounts,
    ) {}

    public function name(): string
    {
        return 'FileNode/get';
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
        $fetchParents = $args['fetchParents'] ?? false;
        if (! is_bool($fetchParents)) {
            throw new JmapMethodException('invalidArguments', 'fetchParents must be a boolean.');
        }

        $principal = $this->accounts->principalFor($username);
        $roots = $this->accounts->rootsFor($username);

        $ids = $this->requestedIds($args);
        $nodes = [];
        $notFound = [];
        if ($ids === null) {
            $this->accounts->reconcileVisibleTree($username);
            foreach ($this->index->liveVisible($roots) as $node) {
                $nodes[(string) $node->node_id] = $node;
            }
            $this->guardGetAllBound(array_values($nodes));
        } else {
            $this->accounts->ensureAccountIndexed($username);
            foreach ($ids as $id) {
                $node = $this->accounts->visibleLiveNode($id, $roots);
                if ($node === null) {
                    $notFound[] = $id;

                    continue;
                }
                $nodes[(string) $node->node_id] = $node;
            }
        }

        if ($fetchParents) {
            foreach (array_values($nodes) as $node) {
                $parentId = $node->parent_node_id;
                while (is_string($parentId) && $parentId !== '' && ! isset($nodes[$parentId])) {
                    $parent = $this->accounts->visibleLiveNode($parentId, $roots);
                    if ($parent === null) {
                        break;
                    }
                    $nodes[(string) $parent->node_id] = $parent;
                    $parentId = $parent->parent_node_id;
                }
            }
        }

        $list = $this->mapper->toFileNodes(array_values($nodes), $principal);

        return [
            'accountId' => $username,
            'state' => (string) $this->index->currentSeq(),
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
