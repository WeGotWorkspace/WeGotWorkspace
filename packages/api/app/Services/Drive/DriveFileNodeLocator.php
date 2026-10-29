<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;

/**
 * Maps a FileNode id to the file's current path and back, for a file the
 * caller may read (#1751). Docs opens a document by id and needs the path
 * that the collab, threads and rights endpoints still take.
 *
 * Product trash is not found on both forms: an id follows its file into
 * trash, and Docs must not reopen a trashed document through an old link.
 */
final class DriveFileNodeLocator
{
    private const NODE_ID = '/^fn-[0-9a-f]{32}$/';

    public function __construct(
        private DriveService $drive,
        private DriveShareAuthorizer $authorizer,
        private DriveSharePathScope $scope,
        private FileNodeIndexService $fileNodes,
        private StoragePaths $paths,
        private WgwStorage $storage,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{id: string, path: string}
     *
     * @throws \InvalidArgumentException malformed id
     * @throws DriveForbiddenException the caller may not read the file
     * @throws \RuntimeException no such live file
     */
    public function locateById(array $principal, string $nodeId): array
    {
        if (preg_match(self::NODE_ID, $nodeId) !== 1) {
            throw new \InvalidArgumentException('Invalid FileNode id.');
        }
        $virtual = $this->drive->assertReadableNodeId($principal, $nodeId);
        $this->assertNotInTrash($virtual);

        return ['id' => $nodeId, 'path' => $virtual];
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{id: string, path: string}
     *
     * @throws \InvalidArgumentException malformed path
     * @throws DriveForbiddenException the caller may not read the path
     * @throws \RuntimeException no such live file
     */
    public function locateByPath(array $principal, string $path): array
    {
        $this->drive->assertFilesEnabled();
        $virtual = $this->cleanPath($path);
        try {
            $this->authorizer->assertMayRead($virtual, $principal);
        } catch (\InvalidArgumentException $e) {
            throw new DriveForbiddenException($e->getMessage(), 0, $e);
        }
        $this->assertNotInTrash($virtual);

        $key = $this->paths->virtualToStorageKey($virtual);
        if (! $this->storage->files()->fileExists($key)) {
            throw new \RuntimeException('File not found.');
        }
        // A file written outside the index (out-of-band, before a reindex)
        // gets its id here, the same lazy self-heal FileNode reads use.
        $node = $this->fileNodes->liveByKey($key) ?? $this->fileNodes->recordCreate($key);
        if ($node === null || $node->is_dir) {
            throw new \RuntimeException('File not found.');
        }

        return ['id' => (string) $node->node_id, 'path' => $virtual];
    }

    private function cleanPath(string $path): string
    {
        $path = trim($path);
        $segments = explode('/', str_replace('\\', '/', $path));
        if ($path === '' || in_array('..', $segments, true) || str_contains($path, "\0")) {
            throw new \InvalidArgumentException('Invalid path.');
        }
        $virtual = $this->paths->normalizeVirtualPath($path);
        if ($virtual === '/') {
            throw new \InvalidArgumentException('Invalid path.');
        }

        return $virtual;
    }

    private function assertNotInTrash(string $virtual): void
    {
        if ($this->scope->isInProductTrash($virtual)) {
            throw new \RuntimeException('File not found.');
        }
    }
}
