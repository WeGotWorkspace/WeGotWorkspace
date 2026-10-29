<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Exceptions\ApiHttpException;
use App\Services\Drive\CollabDocFormats;
use App\Services\Drive\DriveShareAuthorizer;
use App\Storage\StoragePaths;

/**
 * Which Doc a thread route may touch. A Doc the caller may not read is not found (404);
 * only a reader learns that it lacks the right to comment (403).
 */
final class DocsThreadDocAccess
{
    public function __construct(
        private readonly DriveShareAuthorizer $authorizer,
        private readonly StoragePaths $paths,
        private readonly CollabDocFormats $collabDocs,
    ) {}

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function requireReadable(string $path, array $principal): string
    {
        $path = $this->docPath($path);
        $this->readableRights($path, $principal);

        return $path;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function requireCommentable(string $path, array $principal): string
    {
        $path = $this->docPath($path);
        if (! $this->readableRights($path, $principal)['mayComment']) {
            throw new ApiHttpException(403, 'Access denied for this path.', 'forbidden');
        }

        return $path;
    }

    private function docPath(string $path): string
    {
        $path = $this->paths->normalizeVirtualPath($path);
        if (! $this->collabDocs->isCollabDocPath($path)) {
            throw new ApiHttpException(400, 'Threads are only available on Docs files.', 'bad_request');
        }

        return $path;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     * @return array{mayView: bool, mayComment: bool, mayReview: bool, mayEditContent: bool, mayManageStructure: bool, mayShare: bool}
     */
    private function readableRights(string $path, array $principal): array
    {
        try {
            $rights = $this->authorizer->effectiveRights($path, $principal);
        } catch (\InvalidArgumentException) {
            throw new ApiHttpException(404, 'Document not found.', 'not_found');
        }
        if (! $rights['mayView']) {
            throw new ApiHttpException(404, 'Document not found.', 'not_found');
        }

        return $rights;
    }
}
