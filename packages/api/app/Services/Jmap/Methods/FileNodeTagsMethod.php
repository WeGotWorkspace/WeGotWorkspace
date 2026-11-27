<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeSyncState;
use App\Services\Jmap\FileNodes\FileNodeTags;
use App\Services\Jmap\JmapCapabilities;

/**
 * FileNode/tags (WGW extension, #2402): the tags in use across the nodes the
 * account can see, with how many nodes carry each. Trashed nodes and hidden
 * trees are left out. Read-only; no arguments besides accountId.
 */
final class FileNodeTagsMethod implements JmapMethodInterface
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeAccountSupport $accounts,
        private readonly FileNodeSyncState $syncState,
        private readonly FileNodeTags $tags,
    ) {}

    public static function name(): string
    {
        return 'FileNode/tags';
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
        $roots = $this->accounts->ensureAccountIndexed($username);
        $ids = [];
        foreach ($this->index->liveVisible($roots) as $node) {
            if (! $this->inTrash($node)) {
                $ids[] = (string) $node->node_id;
            }
        }

        return [
            'accountId' => $username,
            'state' => $this->syncState->current($username),
            'list' => $this->tags->countsFor($ids),
        ];
    }

    private function inTrash(JmapFileNode $node): bool
    {
        return preg_match('#(?:^|/)\.Trash(?:/|$)#', (string) $node->storage_key) === 1;
    }
}
