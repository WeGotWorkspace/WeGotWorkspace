<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\Download\DownloadTicketService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeMapper;
use App\Storage\StoragePaths;

/**
 * Download tickets by drive path (#1622), for share-link guests first: a
 * guest only knows paths, so this finds the file's FileNode and its current
 * blobId, then issues an ordinary download ticket. A guest's ticket is bound
 * to its share session; a signed-in caller's to its sign-in session, exactly
 * as on `POST /jmap/download-tickets`.
 */
final class PathDownloadTicketIssuer
{
    public function __construct(
        private readonly DriveService $drive,
        private readonly StoragePaths $paths,
        private readonly FileNodeIndexService $index,
        private readonly FileNodeMapper $mapper,
        private readonly DownloadTicketService $tickets,
    ) {}

    /**
     * @param  array{username: string, role: string, sid?: string}  $principal
     * @return array{url: string, idleExpires: string, absoluteExpires: string}
     */
    public function issue(array $principal, string $path): array
    {
        if (trim($path) === '' || strlen($path) > 4096 || $this->paths->hasParentSegment($path)) {
            throw new ApiHttpException(404, 'Path not found.', 'not_found');
        }

        try {
            // Files enabled, mayRead inside the share, and the file exists.
            $this->drive->assertReadableFile($principal, $path);
        } catch (\InvalidArgumentException|\RuntimeException) {
            throw new ApiHttpException(404, 'Path not found.', 'not_found');
        }

        $virtual = $this->paths->normalizeVirtualPath($path);
        $key = $this->paths->virtualToStorageKey($virtual);
        $node = $this->index->liveByKey($key);
        if ($node === null && $this->index->isIndexableKey($key)) {
            // A file written out of band that no listing has indexed yet.
            $node = $this->index->recordCreate($key);
        }
        if ($node === null || (bool) $node->is_dir) {
            throw new ApiHttpException(404, 'Path not found.', 'not_found');
        }

        $blobId = $this->mapper->blobId($node);
        $name = basename($virtual);
        if ($principal['role'] === 'guest') {
            return $this->tickets->issueForGuest($principal['username'], $blobId, $name, null);
        }

        return $this->tickets->issue($principal, $blobId, $name, null);
    }
}
