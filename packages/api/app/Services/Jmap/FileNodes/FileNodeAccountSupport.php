<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveGroupResolver;

/**
 * Per-account context for the FileNode envelope methods: the drive principal
 * shape, the visible roots (own tree + member groups — design decision 5),
 * and visibility checks against them.
 */
final class FileNodeAccountSupport
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly DriveGroupResolver $groups,
        private readonly AdminRoleResolver $adminRoles,
    ) {}

    /**
     * @return array{username: string, role: string}
     */
    public function principalFor(string $username): array
    {
        return [
            'username' => $username,
            'role' => $this->adminRoles->isAdmin($username) ? 'admin' : 'user',
        ];
    }

    /**
     * @return list<string>
     */
    public function rootsFor(string $username): array
    {
        return $this->index->visibleRoots($username, $this->groups->allowedGroupSlugs($username));
    }

    public function ensureAccountIndexed(string $username): void
    {
        $this->index->ensureRootsIndexed($username, $this->groups->allowedGroupSlugs($username));
    }

    /**
     * @param  list<string>  $roots
     */
    public function visibleLiveNode(string $nodeId, array $roots): ?JmapFileNode
    {
        $node = $this->index->liveByNodeId($nodeId);
        if ($node === null || ! $this->index->isVisibleKey((string) $node->storage_key, $roots)) {
            return null;
        }

        return $node;
    }

    /**
     * Reconcile the whole visible tree (used by get-all and unfiltered
     * queries): BFS from the roots, reconciling each directory's children.
     * Bounded in practice by maxObjectsInGet on the caller side.
     */
    public function reconcileVisibleTree(string $username): void
    {
        $this->ensureAccountIndexed($username);
        $queue = [];
        foreach ($this->rootsFor($username) as $root) {
            $node = $this->index->liveByKey($root);
            if ($node !== null) {
                $queue[] = $node;
            }
        }
        $guard = 0;
        while ($queue !== [] && $guard < 2_000) {
            $dir = array_shift($queue);
            $guard++;
            $this->index->reconcileDirectory((string) $dir->storage_key);
            foreach ($this->index->liveChildren((string) $dir->node_id) as $child) {
                if ($child->is_dir) {
                    $queue[] = $child;
                }
            }
        }
    }
}
