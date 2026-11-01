<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Services\Contacts\ContactBlobService;
use App\Services\Jmap\FileNodes\FileNodeBlobResolver;

/**
 * Every blobId the envelope surfaces must be downloadable (#438, #450):
 * envelope blobs (`jb-…`), contacts REST blobs (UUID-shaped), and drive
 * content through node-derived `fnb-…` ids. Shared by the authenticated
 * download route and download tickets, so both run the same rights checks.
 *
 * Not final: feature tests swap in a slow stream to exercise the ticket's
 * sliding expiry during a long response.
 */
class JmapDownloadBlobResolver
{
    public function __construct(
        private readonly JmapBlobService $blobs,
        private readonly ContactBlobService $contactBlobs,
        private readonly FileNodeBlobResolver $fileNodeBlobs,
    ) {}

    public function resolve(string $username, string $blobId): ?BlobContent
    {
        $envelope = $this->blobs->retrieveContent($username, $blobId);
        if ($envelope !== null) {
            return $envelope;
        }

        $contact = $this->contactBlobs->retrieve($username, $blobId);
        if ($contact !== null) {
            return BlobContent::fromString($contact['contents'], $contact['mediaType']);
        }

        return $this->fileNodeBlobs->retrieve($username, $blobId);
    }
}
