<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Drive\DrivePathBookkeeping;
use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Drive\DriveTrashNames;
use App\Storage\WgwStorage;

/**
 * JMAP FileNode/set disk moves and trash. The move and delete bookkeeping
 * itself lives in DrivePathBookkeeping, shared with REST and WebDAV.
 */
final class FileNodeRelocator
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly FileNodeIndexService $index,
        private readonly DrivePathBookkeeping $pathBookkeeping,
        private readonly DriveTrashNames $trashNames,
        private readonly DriveShareAuthorizer $authorizer,
    ) {}

    /**
     * Disk move + all bookkeeping. Returns the moved node.
     * Throws FileNodeSetError(serverFail) when the disk move fails.
     */
    public function move(JmapFileNode $node, string $toKey): JmapFileNode
    {
        $fromKey = (string) $node->storage_key;
        if (! $this->storage->files()->move($fromKey, $toKey)) {
            throw new FileNodeSetError(['type' => 'serverFail', 'description' => 'Move failed.']);
        }

        return $this->pathBookkeeping->afterMove($fromKey, $toKey) ?? $node;
    }

    /**
     * D5: when the principal reaches this node only through a member grant, move it to the owner's trash.
     *
     * @param  array{username: string, role: string}  $principal
     */
    public function trashIfGrantee(JmapFileNode $node, array $principal): bool
    {
        $owner = $this->authorizer->memberGrantOwner('/'.$node->storage_key, $principal);
        if ($owner === null) {
            return false;
        }
        $this->trashForOwner($node, $owner);

        return true;
    }

    /** D5: move a node into users/{owner}/.Trash under a unique name. */
    public function trashForOwner(JmapFileNode $node, string $ownerUsername): JmapFileNode
    {
        $trashKey = 'users/'.$ownerUsername.'/.Trash';
        $disk = $this->storage->files();
        if (! $disk->directoryExists($trashKey)) {
            $disk->makeDirectory($trashKey);
        }
        $this->index->recordCreate($trashKey);
        $name = $this->trashNames->unique($disk, $trashKey, (string) $node->name);

        return $this->move($node, $trashKey.'/'.$name);
    }

    /** All bookkeeping after a hard delete that already landed on disk. */
    public function afterHardDelete(string $key): void
    {
        $this->pathBookkeeping->afterDelete($key);
    }
}
