<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Log;

/**
 * Moves or deletes the hidden `.{name}.yjs` file beside a document.
 *
 * A directory rename or delete already carries nested sidecars, because they
 * are ordinary files in that tree. This only relocates the sibling of the
 * key that moved or disappeared. Same-principal renames are the common case
 * and are not skipped.
 *
 * An absent sidecar is left alone, including an orphan already at the
 * destination. When the moved document has its own sidecar, that history
 * replaces an orphan at the destination.
 */
final class CollabSidecarMover
{
    public function __construct(
        private readonly WgwStorage $storage,
        private readonly StoragePaths $paths,
    ) {}

    public function moveWithDocument(string $fromKey, string $toKey): void
    {
        try {
            $this->move($fromKey, $toKey);
        } catch (\Throwable $e) {
            Log::warning('collab_yjs_sidecar_failed', [
                'op' => 'move',
                'from' => $fromKey,
                'to' => $toKey,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public function deleteWithDocument(string $documentKey): void
    {
        try {
            $this->delete($documentKey);
        } catch (\Throwable $e) {
            Log::warning('collab_yjs_sidecar_failed', [
                'op' => 'delete',
                'key' => $documentKey,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function move(string $fromKey, string $toKey): void
    {
        if ($fromKey === $toKey) {
            return;
        }
        $fromSidecar = $this->sidecarKey($fromKey);
        $toSidecar = $this->sidecarKey($toKey);
        if ($fromSidecar === null || $toSidecar === null || $fromSidecar === $toSidecar) {
            return;
        }
        $disk = $this->storage->files();
        if (! $disk->fileExists($fromSidecar)) {
            return;
        }
        if ($disk->fileExists($toSidecar) && ! $disk->delete($toSidecar)) {
            throw new \RuntimeException('Could not replace the destination Yjs sidecar.');
        }
        if (! $disk->move($fromSidecar, $toSidecar)) {
            throw new \RuntimeException('Could not move the Yjs sidecar.');
        }
    }

    private function delete(string $documentKey): void
    {
        $sidecar = $this->sidecarKey($documentKey);
        if ($sidecar === null) {
            return;
        }
        $disk = $this->storage->files();
        if ($disk->fileExists($sidecar) && ! $disk->delete($sidecar)) {
            throw new \RuntimeException('Could not delete the Yjs sidecar.');
        }
    }

    /**
     * Sibling `.{name}.yjs` only. Rejects traversal so a caller-supplied key
     * cannot escape its parent directory.
     */
    private function sidecarKey(string $documentKey): ?string
    {
        $documentKey = trim(str_replace('\\', '/', $documentKey), '/');
        if ($documentKey === '' || $this->rejectsKey($documentKey)) {
            return null;
        }
        $name = basename($documentKey);
        if ($name === '' || CollabSidecarPaths::isSidecarName($name)) {
            return null;
        }

        $sidecarKey = $this->paths->virtualToStorageKey(
            CollabSidecarPaths::sidecarVirtualPath($this->paths, '/'.$documentKey),
        );
        if ($this->rejectsKey($sidecarKey) || ! CollabSidecarPaths::isSidecarName(basename($sidecarKey))) {
            return null;
        }
        if (dirname($sidecarKey) !== dirname($documentKey)) {
            return null;
        }

        return $sidecarKey;
    }

    private function rejectsKey(string $key): bool
    {
        if (str_contains($key, "\0")) {
            return true;
        }
        foreach (explode('/', $key) as $segment) {
            if ($segment === '' || $segment === '.' || $segment === '..') {
                return true;
            }
        }

        return false;
    }
}
