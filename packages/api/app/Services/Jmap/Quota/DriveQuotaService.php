<?php

declare(strict_types=1);

namespace App\Services\Jmap\Quota;

use App\Models\JmapFileNode;
use App\Models\Principal;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeMapper;
use App\Storage\WgwStorage;

/**
 * RFC 9425 Drive quotas (#1500): one `octets` quota per root the account
 * can write to — its personal drive and each writable group drive. Share
 * roots granted to the account are not quota roots, and a group drive's
 * bytes are counted once, under the group's quota.
 *
 * `used` is an indexed prefix sum of live file sizes under the root
 * (tombstones excluded, `.Trash` included: its files take real space).
 * `hardLimit = used + free`, so free space (`hardLimit − used`) is the same
 * disk free space for every root. Unknown free space → no Drive quotas, so
 * the client skips its up-front warning. hardLimit drifts with other
 * tenants' activity; accepted.
 */
final class DriveQuotaService
{
    public const ID_PREFIX = 'dq-';

    public function __construct(
        private readonly FileNodeAccountSupport $accounts,
        private readonly FileNodeIndexService $index,
        private readonly FileNodeMapper $mapper,
        private readonly FreeSpaceSource $freeSpace,
        private readonly WgwStorage $storage,
    ) {}

    /**
     * @return list<array{id: string, resourceType: string, used: int, hardLimit: int, scope: string, name: string, types: list<string>, description: null}>
     */
    public function quotasFor(string $username): array
    {
        $free = $this->freeSpace->freeBytes($this->storage->files());
        if ($free === null) {
            return [];
        }

        $this->accounts->ensureAccountIndexed($username);
        $principal = $this->accounts->principalFor($username);

        $quotas = [];
        foreach ($this->accounts->accountRootsFor($username) as $rootKey) {
            $root = $this->index->liveByKey($rootKey);
            if ($root === null || ! $root->is_dir) {
                continue;
            }
            if (! $this->mapper->rightsFor($rootKey, $principal)['mayAddChildren']) {
                continue;
            }
            $used = $this->usedBytes($rootKey);
            $quotas[] = [
                // Derived from the root's node id, which survives renames,
                // never from the slug or the path.
                'id' => self::ID_PREFIX.(string) $root->node_id,
                'resourceType' => 'octets',
                'used' => $used,
                'hardLimit' => $used + max(0, $free),
                'scope' => 'account',
                'name' => $this->nameFor($rootKey),
                'types' => ['FileNode'],
                'description' => null,
            ];
        }

        return $quotas;
    }

    /**
     * Sum of size_bytes of live file rows under the root
     * (storage_key, deleted_at index). `!` is the LIKE escape: a backslash
     * ESCAPE clause is a syntax error on MySQL.
     */
    public function usedBytes(string $rootKey): int
    {
        $pattern = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], trim($rootKey, '/')).'/%';

        return (int) JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where('is_dir', false)
            ->whereRaw("storage_key LIKE ? ESCAPE '!'", [$pattern])
            ->sum('size_bytes');
    }

    private function nameFor(string $rootKey): string
    {
        if (str_starts_with($rootKey, 'groups/')) {
            $slug = substr($rootKey, strlen('groups/'));
            $display = Principal::query()->where('uri', 'principals/groups/'.$slug)->value('displayname');

            return is_string($display) && trim($display) !== '' ? trim($display) : $slug;
        }

        return 'Personal drive';
    }
}
