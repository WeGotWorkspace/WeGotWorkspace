<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\DriveShareGrant;
use App\Models\JmapFileNode;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveShareGrantResolver;
use App\Services\Jmap\Guest\GuestJmapAccounts;
use App\Services\Jmap\JmapRequestContext;
use App\Storage\StorageKeyClass;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;

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
        private readonly JmapRequestContext $context,
        private readonly WgwStorage $storage,
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

        return FileNodeVisibility::roots($username, $this->groups->allowedGroupSlugs($username));
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

        return $this->rootsWith($username, $this->liveMemberGrantsOf($username));
    }

    /**
     * {@see rootsFor()} plus {@see accountRootsAndGrantPairs()} from one read of the member Teams
     * and grants, for the JMAP push check (#2243).
     *
     * @return array{roots: list<string>, accountRoots: list<string>, grantPairs: string}
     */
    public function rootsAndGrantPairs(string $username): array
    {
        $scope = $this->scopeOf($username);

        return [
            'roots' => $scope['grants'] === null ? $scope['accountRoots'] : $this->rootsWith($username, $scope['grants']),
            'accountRoots' => $scope['accountRoots'],
            'grantPairs' => $this->grantPairsOf($scope['grants'] ?? []),
        ];
    }

    /**
     * The account roots (own tree + member Teams) and the sorted `grantId:access` lines of the
     * user's live, visible member grants, from one read of the member Teams. The FileNode state
     * carries their hash (#2063): a Team join or leave, hiding a grant or changing its access in
     * place moves neither the global change sequence nor the root markers (#1926).
     *
     * @return array{accountRoots: list<string>, grantPairs: string}
     */
    public function accountRootsAndGrantPairs(string $username): array
    {
        $scope = $this->scopeOf($username);

        return ['accountRoots' => $scope['accountRoots'], 'grantPairs' => $this->grantPairsOf($scope['grants'] ?? [])];
    }

    /**
     * A guest has its one share root and no grants (null); a member has its own tree, its
     * member Teams and its live member grants.
     *
     * @return array{accountRoots: list<string>, grants: list<DriveShareGrant>|null}
     */
    private function scopeOf(string $username): array
    {
        $guest = $this->guests->find($username);
        if ($guest !== null) {
            return ['accountRoots' => [$guest->rootKey], 'grants' => null];
        }
        $slugs = $this->groups->allowedGroupSlugs($username);

        return [
            'accountRoots' => FileNodeVisibility::roots($username, $slugs),
            'grants' => $this->liveMemberGrantsOf($username, $slugs),
        ];
    }

    /**
     * @param  list<string>|null  $slugs  the member Teams when the caller already has them
     * @return list<DriveShareGrant>
     */
    private function liveMemberGrantsOf(string $username, ?array $slugs = null): array
    {
        return $this->context->remember(
            'filenode.grants:'.$username,
            fn (): array => $this->grants->liveMemberGrants($username, $slugs ?? $this->groups->allowedGroupSlugs($username)),
        );
    }

    /**
     * @param  list<DriveShareGrant>  $grants
     */
    private function grantPairsOf(array $grants): string
    {
        $pairs = [];
        foreach ($grants as $grant) {
            $pairs[] = $grant->id.':'.$grant->access;
        }
        sort($pairs, SORT_STRING);

        return implode("\n", $pairs);
    }

    /**
     * Own tree + member groups + the share roots of the given live member grants.
     *
     * @param  list<DriveShareGrant>  $grants
     * @return list<string>
     */
    private function rootsWith(string $username, array $grants): array
    {
        return array_values(array_unique([
            ...$this->accountRootsFor($username),
            ...$this->shareRootKeysOf($username, $grants),
        ]));
    }

    /**
     * Once per JMAP batch: later calls in the batch reuse the roots until a write (#2063).
     *
     * @return list<string> the same roots as {@see rootsFor}
     */
    public function ensureAccountIndexed(string $username): array
    {
        return $this->context->remember('filenode.indexed:'.$username, fn (): array => $this->indexAccountRoots($username));
    }

    /** @return list<string> */
    private function indexAccountRoots(string $username): array
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
     * @param  list<DriveShareGrant>  $grants
     * @return list<string>
     */
    private function shareRootKeysOf(string $username, array $grants): array
    {
        $accountRoots = $this->accountRootsFor($username);
        $keys = [];
        foreach ($this->grants->shareRootPathsOf($grants) as $path) {
            if ($this->paths->isNotePath($path)) {
                continue;
            }
            $key = $this->paths->virtualToStorageKey($path);
            if (FileNodeVisibility::isVisibleKey($key, $accountRoots)) {
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
        if ($node === null || ! FileNodeVisibility::isVisibleKey((string) $node->storage_key, $roots)) {
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
        // One query for the whole tree; a folder costs SQL only when its disk listing differs (#2063).
        $rows = JmapFileNode::query()->whereNull('deleted_at');
        FileNodeTreeScope::underRoots($rows, $roots);
        $byKey = [];
        $childrenOf = [];
        foreach ($rows->orderBy('storage_key')->get(['node_id', 'parent_node_id', 'storage_key', 'is_dir']) as $row) {
            $byKey[(string) $row->storage_key] = $row;
            $childrenOf[(string) $row->parent_node_id][] = $row;
        }
        $queue = [];
        foreach ($roots as $root) {
            $node = $byKey[$root] ?? null;
            if ($node !== null) {
                $queue[] = $node;
            }
        }
        $guard = 0;
        while ($queue !== [] && $guard < 2_000) {
            $dir = array_shift($queue);
            $guard++;
            foreach ($this->reconcileDirectoryAgainst($dir, $childrenOf[(string) $dir->node_id] ?? []) as $child) {
                if ($child->is_dir) {
                    $queue[] = $child;
                }
            }
        }
    }

    /**
     * {@see FileNodeIndexService::reconcileDirectory()} against preloaded live `$children`: no SQL
     * unless the disk listing differs from them.
     *
     * @param  list<JmapFileNode>  $children
     * @return list<JmapFileNode>
     */
    private function reconcileDirectoryAgainst(JmapFileNode $dir, array $children): array
    {
        $known = array_fill_keys(array_map(static fn (JmapFileNode $c): string => (string) $c->storage_key, $children), true);
        $seen = 0;
        foreach ($this->storage->files()->listContents((string) $dir->storage_key) as $entry) {
            if (isset($known[$entry->path()])) {
                $seen++;
            } elseif (StorageKeyClass::classify($entry->path())->isFileIndexed()) {
                return $this->index->reconcileDirectory($dir);
            }
        }

        return $seen === count($known) ? $children : $this->index->reconcileDirectory($dir);
    }
}
