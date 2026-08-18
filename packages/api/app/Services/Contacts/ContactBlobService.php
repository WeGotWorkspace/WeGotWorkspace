<?php

declare(strict_types=1);

namespace App\Services\Contacts;

use App\Exceptions\ApiHttpException;
use App\Storage\WgwStorage;
use Illuminate\Support\Str;

/**
 * JMAP-style blob storage for contact media (RFC 9610 / RFC 8620 §6.1 REST equivalent).
 */
final class ContactBlobService
{
    private const MAX_BLOB_BYTES = 5_242_880;

    /** @var list<string> */
    private const IMAGE_MEDIA_PREFIXES = [
        'image/',
    ];

    public function __construct(
        private readonly WgwStorage $storage,
    ) {}

    public function store(string $username, string $mediaType, string $contents): string
    {
        if (strlen($contents) > self::MAX_BLOB_BYTES) {
            throw new ApiHttpException(413, 'Blob exceeds maximum size.', 'payload_too_large');
        }

        $blobId = $this->blobIdFromContent($contents, $mediaType);
        $key = $this->blobKey($username, $blobId);
        if (! $this->storage->data()->exists($key)) {
            $this->storage->data()->put(
                $key,
                json_encode([
                    'mediaType' => $mediaType,
                    'data' => base64_encode($contents),
                ], JSON_THROW_ON_ERROR),
            );
        }

        return $blobId;
    }

    public function storeUploaded(string $username, string $mediaType, string $contents): string
    {
        if (strlen($contents) > self::MAX_BLOB_BYTES) {
            throw new ApiHttpException(413, 'Blob exceeds maximum size.', 'payload_too_large');
        }

        $blobId = (string) Str::uuid();
        $this->storage->data()->put(
            $this->blobKey($username, $blobId),
            json_encode([
                'mediaType' => $mediaType,
                'data' => base64_encode($contents),
            ], JSON_THROW_ON_ERROR),
        );

        return $blobId;
    }

    public function blobIdFromContent(string $contents, string $mediaType): string
    {
        $hash = hash('sha256', $mediaType."\0".$contents);

        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hash, 0, 8),
            substr($hash, 8, 4),
            substr($hash, 12, 4),
            substr($hash, 16, 4),
            substr($hash, 20, 12),
        );
    }

    /**
     * @return array{mediaType: string, contents: string}|null
     */
    public function retrieve(string $username, string $blobId): ?array
    {
        if (! $this->isValidBlobId($blobId)) {
            return null;
        }

        $key = $this->blobKey($username, $blobId);
        // The wgw_data disk is configured with 'throw' => true, so get() on
        // a missing file throws UnableToReadFile instead of returning null —
        // which turned every unknown-blobId lookup into a server error
        // instead of the intended invalid_blob 400. Check existence first.
        if (! $this->storage->data()->exists($key)) {
            return null;
        }

        $raw = $this->storage->data()->get($key);
        if (! is_string($raw) || $raw === '') {
            return null;
        }

        $decoded = json_decode($raw, true);
        if (! is_array($decoded) || ! isset($decoded['data'], $decoded['mediaType'])) {
            return null;
        }

        $contents = base64_decode((string) $decoded['data'], true);
        if ($contents === false) {
            return null;
        }

        return [
            'mediaType' => (string) $decoded['mediaType'],
            'contents' => $contents,
        ];
    }

    public function assertPhotoMediaType(string $mediaType): void
    {
        if (! $this->isImageMediaType($mediaType)) {
            throw new ApiHttpException(
                400,
                'Photo media must use an image media type.',
                'invalid_media_type',
            );
        }
    }

    public function isImageMediaType(string $mediaType): bool
    {
        $normalized = strtolower(trim($mediaType));
        foreach (self::IMAGE_MEDIA_PREFIXES as $prefix) {
            if (str_starts_with($normalized, $prefix)) {
                return true;
            }
        }

        return false;
    }

    public function isValidBlobId(string $blobId): bool
    {
        return preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $blobId,
        ) === 1;
    }

    public function isDataUri(string $uri): bool
    {
        return str_starts_with(strtolower(trim($uri)), 'data:');
    }

    private function blobKey(string $username, string $blobId): string
    {
        return 'contacts/blobs/'.$username.'/'.$blobId.'.json';
    }
}
