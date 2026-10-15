<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Log;

/**
 * Moves and deletes the hidden `.{name}.yjs` file that sits beside one document.
 *
 * A rename inside the same principal still moves that file. Copy does not call
 * this. A missing sidecar is a no-op. Sidecars already orphaned when this
 * ships are left in place; there is no sweeper.
 *
 * A directory rename or delete moves or removes the sidecars inside it with
 * the directory itself. This class only handles the sidecar beside the key
 * that was renamed or deleted.
 */
final class CollabSidecarFiles
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly StoragePaths $paths,
    ) {}

    public function moveWithDocument(string $fromKey, string $toKey): void
    {
        if ($fromKey === $toKey) {
            return;
        }
        $fromSidecar = $this->sidecarKey($fromKey);
        $toSidecar = $this->sidecarKey($toKey);
        if ($fromSidecar === $toSidecar || ! $this->storage->files()->fileExists($fromSidecar)) {
            return;
        }

        try {
            $disk = $this->storage->files();
            if ($disk->fileExists($toSidecar) && ! $disk->delete($toSidecar)) {
                throw new \RuntimeException('Could not replace the Yjs sidecar.');
            }
            if (! $disk->move($fromSidecar, $toSidecar)) {
                throw new \RuntimeException('Could not move the Yjs sidecar.');
            }
        } catch (\Throwable $e) {
            Log::warning('collab_sidecar_sync_failed', [
                'op' => 'move',
                'from' => $fromKey,
                'to' => $toKey,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function deleteWithDocument(string $documentKey): void
    {
        $sidecar = $this->sidecarKey($documentKey);
        $disk = $this->storage->files();
        if (! $disk->fileExists($sidecar)) {
            return;
        }

        try {
            if (! $disk->delete($sidecar)) {
                throw new \RuntimeException('Could not delete the Yjs sidecar.');
            }
        } catch (\Throwable $e) {
            Log::warning('collab_sidecar_sync_failed', [
                'op' => 'delete',
                'path' => $documentKey,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function sidecarKey(string $documentKey): string
    {
        return $this->paths->virtualToStorageKey(
            CollabSidecarPaths::sidecarVirtualPath($this->paths, $documentKey),
        );
    }
}
