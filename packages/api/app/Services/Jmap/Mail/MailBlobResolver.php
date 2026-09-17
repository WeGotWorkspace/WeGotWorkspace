<?php

declare(strict_types=1);

namespace App\Services\Jmap\Mail;

/**
 * Resolves mb- blob ids via live IMAP fetch (no jmap_blobs copy).
 */
final class MailBlobResolver
{
    public function __construct(private JmapMailService $mail) {}

    /**
     * @return array{contents: string, mediaType: string}|null
     */
    public function retrieve(string $username, string $blobId): ?array
    {
        if (! str_starts_with($blobId, 'mb-')) {
            return null;
        }

        return $this->mail->downloadBlob($username, $blobId);
    }
}
