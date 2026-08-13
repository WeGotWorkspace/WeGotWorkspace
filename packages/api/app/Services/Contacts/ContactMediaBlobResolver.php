<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Services\Jmap\Blobs\JmapBlobService;

/**
 * Maps contact Media between vCard data: URIs and blobId references
 * (RFC 9610). On write, blobIds resolve from the contacts REST blob store
 * first, then the JMAP envelope blob store (#438) — a client may reference
 * media it uploaded through either surface.
 */
final class ContactMediaBlobResolver
{
    public function __construct(
        private readonly ContactBlobService $blobs,
        private readonly JmapBlobService $envelopeBlobs,
    ) {}

    /**
     * @param  array<string, mixed>  $contact
     * @return array<string, mixed>
     */
    public function exposeBlobsOnRead(string $username, array $contact): array
    {
        $media = $contact['media'] ?? null;
        if (! is_array($media)) {
            return $contact;
        }

        foreach ($media as $id => $entry) {
            if (! is_array($entry) || ! isset($entry['uri']) || ! is_string($entry['uri'])) {
                continue;
            }
            $uri = $entry['uri'];
            if (! $this->blobs->isDataUri($uri)) {
                continue;
            }

            if (preg_match('#^data:([^;]+);base64,(.+)$#i', $uri, $matches) !== 1) {
                continue;
            }

            $mediaType = $matches[1];
            $contents = base64_decode($matches[2], true);
            if ($contents === false) {
                continue;
            }

            $blobId = $this->blobs->store($username, $mediaType, $contents);
            unset($entry['uri']);
            $entry['blobId'] = $blobId;
            $entry['mediaType'] = $mediaType;
            $media[$id] = $entry;
        }

        $contact['media'] = $media;

        return $contact;
    }

    /**
     * @param  array<string, mixed>  $contact
     * @return array<string, mixed>
     */
    public function resolveBlobsOnWrite(string $username, array $contact): array
    {
        $media = $contact['media'] ?? null;
        if (! is_array($media)) {
            return $contact;
        }

        foreach ($media as $id => $entry) {
            if (! is_array($entry)) {
                continue;
            }

            $blobId = $entry['blobId'] ?? null;
            if (! is_string($blobId) || $blobId === '') {
                continue;
            }

            $stored = $this->blobs->retrieve($username, $blobId)
                ?? $this->envelopeBlobs->retrieve($username, $blobId);
            if ($stored === null) {
                throw new ApiHttpException(400, 'Unknown media blobId.', 'invalid_blob');
            }

            $kind = (string) ($entry['kind'] ?? 'photo');
            if ($kind === 'photo') {
                $this->blobs->assertPhotoMediaType($stored['mediaType']);
            }
            $entry['uri'] = 'data:'.$stored['mediaType'].';base64,'.base64_encode($stored['contents']);
            $entry['mediaType'] = $stored['mediaType'];

            unset($entry['blobId']);
            $media[$id] = $entry;
        }

        $contact['media'] = $media;

        return $contact;
    }
}
