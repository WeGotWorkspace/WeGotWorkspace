<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Exceptions\ApiHttpException;
use App\Models\JmapBlob;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;

/**
 * Envelope-owned blob store (RFC 8620 §6, #438): content-addressed ids,
 * metadata rows in jmap_blobs, raw bytes on the wgw_data disk. Distinct from
 * the contacts REST blob store (ContactBlobService, UUID-shaped ids) — the
 * two coexist; the envelope download endpoint and the contacts media
 * resolver accept ids from either store.
 *
 * Unreferenced blobs expire after a TTL (well above the RFC's 1-hour
 * minimum); re-uploading refreshes the expiry. Garbage collection lives in
 * JmapBlobGarbageCollector and honours domain reference checkers — a blob
 * referenced by a domain object (a future FileNode, per
 * draft-ietf-jmap-filenode-14) is never collected.
 */
final class JmapBlobService
{
    private const BLOB_ID_PREFIX = 'jb-';

    private const BLOB_ID_PATTERN = '/^jb-[0-9a-f]{40}$/';

    public function __construct(private readonly WgwStorage $storage) {}

    public static function maxSizeUpload(): int
    {
        return max(0, (int) config('wgw.jmap.max_size_upload', 25_000_000));
    }

    /**
     * @return array{blobId: string, type: string, size: int}
     */
    public function store(string $username, string $mediaType, string $contents): array
    {
        if (strlen($contents) > self::maxSizeUpload()) {
            throw new ApiHttpException(400, 'Blob exceeds maxSizeUpload.', 'limit');
        }

        $sha256 = hash('sha256', $contents);
        // Content-addressed: identical bytes dedupe to one blob per account.
        $blobId = self::BLOB_ID_PREFIX.substr($sha256, 0, 40);
        $mediaType = trim($mediaType) === '' ? 'application/octet-stream' : trim($mediaType);
        $expiresAt = Carbon::now()->addHours(max(1, (int) config('wgw.jmap.blob_ttl_hours', 24)));

        $key = $this->blobKey($username, $blobId);
        if (! $this->storage->data()->exists($key)) {
            $this->storage->data()->put($key, $contents);
        }

        JmapBlob::query()->updateOrCreate(
            ['username' => $username, 'blob_id' => $blobId],
            [
                'media_type' => $mediaType,
                'size_bytes' => strlen($contents),
                'sha256' => $sha256,
                'expires_at' => $expiresAt,
            ],
        );

        return [
            'blobId' => $blobId,
            'type' => $mediaType,
            'size' => strlen($contents),
        ];
    }

    /**
     * @return array{contents: string, mediaType: string, size: int}|null
     */
    public function retrieve(string $username, string $blobId): ?array
    {
        if (preg_match(self::BLOB_ID_PATTERN, $blobId) !== 1) {
            return null;
        }

        $row = JmapBlob::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->first();
        if ($row === null) {
            return null;
        }

        $key = $this->blobKey($username, $blobId);
        // The wgw_data disk throws on missing files ('throw' => true) — check
        // existence first, same lesson as ContactBlobService::retrieve().
        if (! $this->storage->data()->exists($key)) {
            return null;
        }
        $contents = $this->storage->data()->get($key);
        if (! is_string($contents)) {
            return null;
        }

        return [
            'contents' => $contents,
            'mediaType' => is_string($row->media_type) && $row->media_type !== ''
                ? $row->media_type
                : 'application/octet-stream',
            'size' => strlen($contents),
        ];
    }

    public function delete(string $username, string $blobId): void
    {
        $key = $this->blobKey($username, $blobId);
        if ($this->storage->data()->exists($key)) {
            $this->storage->data()->delete($key);
        }
        JmapBlob::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->delete();
    }

    private function blobKey(string $username, string $blobId): string
    {
        return 'jmap/blobs/'.$username.'/'.$blobId;
    }
}
