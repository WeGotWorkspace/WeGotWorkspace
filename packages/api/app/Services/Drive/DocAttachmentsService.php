<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Sidecar tree for Docs image uploads. Relocate/destroy are idempotent and
 * best-effort: a failed sidecar never rolls back the Doc move or destroy.
 */
final class DocAttachmentsService
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly FileNodeIndexService $index,
        private readonly CollabDocFormats $docs,
    ) {}

    public function ensureFolderForDoc(string $docNodeId): JmapFileNode
    {
        $doc = $this->index->liveByNodeId($docNodeId);
        if ($doc === null) {
            throw new \InvalidArgumentException('Doc FileNode not found.');
        }
        $prefix = DocAttachmentPaths::principalPrefix((string) $doc->storage_key);
        if ($prefix === null) {
            throw new \InvalidArgumentException('Doc FileNode has no drive principal prefix.');
        }

        $disk = $this->storage->files();
        $rootKey = DocAttachmentPaths::attachmentsRootKey($prefix);
        $folderKey = DocAttachmentPaths::folderKey($prefix, $docNodeId);

        if (! $disk->directoryExists($rootKey)) {
            $disk->makeDirectory($rootKey);
            $this->index->recordCreate($rootKey);
        }
        if (! $disk->directoryExists($folderKey)) {
            $disk->makeDirectory($folderKey);
            $this->index->recordCreate($folderKey);
        }

        $folder = $this->index->liveByKey($folderKey);
        if ($folder === null) {
            throw new \RuntimeException('Could not index the Doc attachments folder.');
        }

        return $folder;
    }

    public function storeImageForDoc(string $docNodeId, string $contents, string $extension): JmapFileNode
    {
        $folder = $this->ensureFolderForDoc($docNodeId);
        $ext = $this->normalizeExtension($extension);
        $tmpKey = (string) $folder->storage_key.'/upload-'.Str::uuid()->toString().($ext !== '' ? '.'.$ext : '');
        $this->storage->files()->put($tmpKey, $contents);
        $node = $this->index->recordContentWrite($tmpKey, hash('sha256', $contents));
        if ($node === null) {
            throw new \RuntimeException('Could not index the Doc attachment.');
        }

        $finalKey = (string) $folder->storage_key.'/'.$node->node_id.($ext !== '' ? '.'.$ext : '');
        if ($finalKey === $tmpKey) {
            return $node;
        }
        if (! $this->storage->files()->move($tmpKey, $finalKey)) {
            throw new \RuntimeException('Could not store the Doc attachment.');
        }

        return $this->index->recordMove($tmpKey, $finalKey) ?? $node;
    }

    /**
     * Move `{oldPrefix}/.attachments/{docId}` to the Doc's current principal
     * prefix. Already at dest / source missing → no-op.
     */
    public function relocateForDoc(string $docNodeId): void
    {
        $doc = $this->index->liveByNodeId($docNodeId);
        if ($doc === null) {
            return;
        }
        $prefix = DocAttachmentPaths::principalPrefix((string) $doc->storage_key);
        if ($prefix === null) {
            return;
        }
        $destKey = DocAttachmentPaths::folderKey($prefix, $docNodeId);
        $disk = $this->storage->files();
        $folders = $this->liveAttachmentFolders($docNodeId);

        $sourceKey = null;
        foreach ($folders as $folder) {
            $key = (string) $folder->storage_key;
            if ($key === $destKey) {
                return;
            }
            $sourceKey = $key;
        }
        if ($sourceKey === null) {
            return;
        }
        if ($disk->directoryExists($destKey) && ! $disk->directoryExists($sourceKey)) {
            $this->index->recordMove($sourceKey, $destKey);

            return;
        }
        if ($disk->directoryExists($destKey) || ! $disk->directoryExists($sourceKey)) {
            return;
        }

        $destRoot = DocAttachmentPaths::attachmentsRootKey($prefix);
        if (! $disk->directoryExists($destRoot)) {
            $disk->makeDirectory($destRoot);
            $this->index->recordCreate($destRoot);
        }
        if (! $disk->move($sourceKey, $destKey)) {
            throw new \RuntimeException('Could not relocate Doc attachments.');
        }
        $this->index->recordMove($sourceKey, $destKey);
    }

    /**
     * Delete `{principal}/.attachments/{docId}/`. Missing folder → no-op.
     */
    public function destroyForDoc(string $docNodeId): void
    {
        $disk = $this->storage->files();
        $keys = [];
        foreach ($this->liveAttachmentFolders($docNodeId) as $folder) {
            $keys[] = (string) $folder->storage_key;
        }
        $doc = $this->index->liveByNodeId($docNodeId);
        if ($doc !== null) {
            $prefix = DocAttachmentPaths::principalPrefix((string) $doc->storage_key);
            if ($prefix !== null) {
                $keys[] = DocAttachmentPaths::folderKey($prefix, $docNodeId);
            }
        }
        foreach (array_values(array_unique($keys)) as $key) {
            if ($disk->directoryExists($key)) {
                $disk->deleteDirectory($key);
            }
            $this->index->recordDelete($key);
        }
    }

    /**
     * @return list<string>
     */
    public function docNodeIdsForDestroyKey(string $key): array
    {
        if (DocAttachmentPaths::isUnderAttachmentsKey($key)) {
            return [];
        }

        $ids = [];
        foreach ($this->index->liveSelfAndDescendants($key) as $node) {
            if ($node->is_dir) {
                continue;
            }
            if ($this->docs->isCollabDocPath('/'.ltrim((string) $node->storage_key, '/'))) {
                $ids[] = (string) $node->node_id;
            }
        }

        return array_values(array_unique($ids));
    }

    public function relocateAfterMove(string $fromKey, string $toKey): void
    {
        if (DocAttachmentPaths::principalPrefix($fromKey) === DocAttachmentPaths::principalPrefix($toKey)) {
            return;
        }
        foreach ($this->docNodeIdsForDestroyKey($toKey) as $docNodeId) {
            try {
                $this->relocateForDoc($docNodeId);
            } catch (\Throwable $e) {
                Log::warning('doc_attachments_sidecar_failed', [
                    'op' => 'relocate',
                    'docNodeId' => $docNodeId,
                    'from' => $fromKey,
                    'to' => $toKey,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * @param  list<string>  $docNodeIds
     */
    public function destroyDocsBestEffort(array $docNodeIds): void
    {
        foreach ($docNodeIds as $docNodeId) {
            try {
                $this->destroyForDoc($docNodeId);
            } catch (\Throwable $e) {
                Log::warning('doc_attachments_sidecar_failed', [
                    'op' => 'destroy',
                    'docNodeId' => $docNodeId,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    public function relocateAfterMoveBestEffort(string $fromKey, string $toKey): void
    {
        try {
            $this->relocateAfterMove($fromKey, $toKey);
        } catch (\Throwable $e) {
            Log::warning('doc_attachments_sidecar_failed', [
                'op' => 'relocate',
                'from' => $fromKey,
                'to' => $toKey,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * @return list<JmapFileNode>
     */
    private function liveAttachmentFolders(string $docNodeId): array
    {
        $rows = JmapFileNode::query()
            ->whereNull('deleted_at')
            ->where('is_dir', true)
            ->where('name', $docNodeId)
            ->get();

        $out = [];
        foreach ($rows as $row) {
            if (DocAttachmentPaths::isDocFolderKey((string) $row->storage_key, $docNodeId)) {
                $out[] = $row;
            }
        }

        return $out;
    }

    private function normalizeExtension(string $extension): string
    {
        $ext = strtolower(ltrim($extension, '.'));
        if ($ext === '' || str_contains($ext, '/') || str_contains($ext, '\\')) {
            return '';
        }

        return $ext;
    }
}
