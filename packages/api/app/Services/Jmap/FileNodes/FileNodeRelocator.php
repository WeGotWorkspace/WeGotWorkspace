<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapFileNode;
use App\Services\Docs\DocsThreadRepository;
use App\Services\Drive\DocAttachmentsService;
use App\Services\Drive\DriveShareAuthorizer;
use App\Services\Drive\DriveShareService;
use App\Services\Drive\DriveStarService;
use App\Services\Drive\DriveTrashNames;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Log;

/**
 * Disk move plus the bookkeeping DriveService already does on REST rename:
 * search, attachments, stars, share paths, and docs threads (#990 D6).
 */
final class FileNodeRelocator
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly FileNodeIndexService $index,
        private readonly SearchIndexerService $search,
        private readonly BestEffortSearchIndexSync $searchSync,
        private readonly DocAttachmentsService $docAttachments,
        private readonly DriveStarService $stars,
        private readonly DriveShareService $shares,
        private readonly DocsThreadRepository $docsThreads,
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
        $node = $this->index->recordMove($fromKey, $toKey) ?? $node;
        $this->syncSearchMove($fromKey, $toKey);
        $this->docAttachments->relocateAfterMoveBestEffort($fromKey, $toKey);
        $this->stars->rewritePathPrefix($fromKey, $toKey);
        $this->shares->rewritePathPrefix('/'.$fromKey, '/'.$toKey);
        $this->bestEffortThreads(fn () => $this->docsThreads->retargetPath('/'.$fromKey, '/'.$toKey));

        return $node;
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

    /** Bookkeeping after a hard delete: docs threads (D6). */
    public function afterHardDelete(string $key): void
    {
        $this->bestEffortThreads(fn () => $this->docsThreads->dropPath('/'.$key));
    }

    private function bestEffortThreads(callable $operation): void
    {
        try {
            $operation();
        } catch (\Throwable $e) {
            Log::warning('docs_thread_path_sync_failed', ['error' => $e->getMessage()]);
        }
    }

    private function syncSearchMove(string $fromKey, string $toKey): void
    {
        $this->searchSync->sync(
            'filenode',
            function () use ($fromKey, $toKey): void {
                $this->search->deleteDavPath('files/'.$fromKey);
                $this->search->indexFileStorageKey($toKey);
                $disk = $this->storage->files();
                if (! $disk->directoryExists($toKey)) {
                    return;
                }
                foreach ($disk->allDirectories($toKey) as $dirKey) {
                    $this->search->indexFileStorageKey($dirKey);
                }
                foreach ($disk->allFiles($toKey) as $fileKey) {
                    $this->search->indexFileStorageKey($fileKey);
                }
            },
            'files/'.$toKey,
        );
    }
}
