<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveShareGrantResolver;
use App\Services\Jmap\Guest\GuestJmapAccounts;
use App\Storage\StoragePaths;

/**
 * Per-account context for the FileNode envelope methods: the drive principal
 * shape, the visible roots (own tree + member groups + live member-grant
 * share roots — #990), and visibility checks against them.
 *
 * A guest upload account (#1715) is known only through the request-scoped
 * {@see GuestJmapAccounts} registry the guest gate fills: its principal is
 * the guest, and its one root is the share root.
 */
final class FileNodeAccountSupport
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly DriveGroupResolver $groups,
        private readonly AdminRoleResolver $adminRoles,
        private readonly DriveShareGrantResolver $grants,
        private readonly StoragePaths $paths,
        private readonly GuestJmapAccounts $guests,
    ) {}

    /**
     * @return array{username: string, role: string}
     */
    public function principalFor(string $username): array
    {
        $guest = $this->guests->find($username);
        if ($guest !== null) {
            return $guest->principal;
        }

        return [
            'username' => $username,
            'role' => $this->adminRoles->isAdmin($username) ? 'admin' : 'user',
        ];
    }

    /**
     * Own tree + member groups. Share roots are not included (#990 D2).
     *
     * @return list<string>
     */
    public function accountRootsFor(string $username): array
    {
        $guest = $this->guests->find($username);
        if ($guest !== null) {
            return [$guest->rootKey];
        }

        return $this->index->visibleRoots($username, $this->groups->allowedGroupSlugs($username));
    }

    /**
     * Own tree + member groups + live member-grant share roots (#990).
     *
     * @return list<string>
     */
    public function rootsFor(string $username): array
    {
        $guest = $this->guests->find($username);
        if ($guest !== null) {
            return [$guest->rootKey];
        }

        return array_values(array_unique([
            ...$this->accountRootsFor($username),
            ...$this->shareRootKeysFor($username),
        ]));
    }

    /**
     * Sorted `grantId:access` lines of the user's live, visible member grants. The FileNode
     * state and push basis carry their hash, because hiding a grant or changing its access in
     * place moves neither the global change sequence nor the root markers (#1926).
     */
    public function memberGrantPairs(string $username): string
    {
        if ($this->guests->find($username) !== null) {
            return '';
        }

        $pairs = [];
        foreach ($this->grants->liveMemberGrants($username, $this->groups->allowedGroupSlugs($username)) as $grant) {
            $pairs[] = $grant->id.':'.$grant->access;
        }
        sort($pairs, SORT_STRING);

        return implode("\n", $pairs);
    }

    /**
     * @return list<string> the same roots as {@see rootsFor}
     */
    public function ensureAccountIndexed(string $username): array
    {
        $roots = $this->rootsFor($username);
        $guest = $this->guests->find($username);
        if ($guest !== null) {
            if ($this->index->liveByKey($guest->rootKey) === null) {
                $this->index->recordCreate($guest->rootKey);
            }

            return $roots;
        }
        $accountRoots = $this->accountRootsFor($username);
        $this->index->ensureRootsIndexed($username, $this->groups->allowedGroupSlugs($username));
        foreach (array_diff($roots, $accountRoots) as $key) {
            if ($this->index->liveByKey($key) === null) {
                // recordCreate keeps the owner's parent; do not mint a root here.
                $this->index->recordCreate($key);
            }
        }

        return $roots;
    }

    /**
     * @return list<string>
     */
    private function shareRootKeysFor(string $username): array
    {
        $accountRoots = $this->accountRootsFor($username);
        $keys = [];
        foreach ($this->grants->memberShareRootPaths($username, $this->groups->allowedGroupSlugs($username)) as $path) {
            if ($this->paths->isNotePath($path)) {
                continue;
            }
            $key = $this->paths->virtualToStorageKey($path);
            if ($this->index->isVisibleKey($key, $accountRoots)) {
                continue;
            }
            $keys[$key] = $key;
        }

        return array_values($keys);
    }

    /**
     * @param  list<string>  $roots
     */
    public function visibleLiveNode(string $nodeId, array $roots, ?JmapFileNode $loaded = null): ?JmapFileNode
    {
        $node = $loaded ?? $this->index->liveByNodeId($nodeId);
        if ($node === null || ! $this->index->isVisibleKey((string) $node->storage_key, $roots)) {
            return null;
        }

        return $node;
    }

    /**
     * Reconcile the whole visible tree (used by get-all and unfiltered
     * queries): BFS from the roots, reconciling each directory's children.
     * Bounded in practice by maxObjectsInGet on the caller side.
     *
     * @param  list<string>  $roots  from {@see ensureAccountIndexed}
     */
    public function reconcileVisibleTree(array $roots): void
    {
        $queue = [];
        foreach ($roots as $root) {
            $node = $this->index->liveByKey($root);
            if ($node !== null) {
                $queue[] = $node;
            }
        }
        $guard = 0;
        while ($queue !== [] && $guard < 2_000) {
            $dir = array_shift($queue);
            $guard++;
            foreach ($this->index->reconcileDirectory($dir) as $child) {
                if ($child->is_dir) {
                    $queue[] = $child;
                }
            }
        }
    }
}
