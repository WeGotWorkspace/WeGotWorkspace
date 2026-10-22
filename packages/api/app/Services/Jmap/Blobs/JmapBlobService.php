<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Exceptions\ApiHttpException;
use App\Models\JmapBlob;
use App\Storage\Local\LocalDiskFiles;
use App\Storage\Streams\HashingStreamFilter;
use App\Storage\Streams\StreamDigest;
use App\Storage\WgwStorage;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Envelope-owned blob store (RFC 8620 §6, #438): content-addressed ids,
 * metadata rows in jmap_blobs, raw bytes on the wgw_data disk. Distinct from
 * the contacts REST blob store (ContactBlobService, UUID-shaped ids) — the
 * two coexist; the envelope download endpoint and the contacts media
 * resolver accept ids from either store.
 *
 * Bytes are streamed in and hashed while they are written (#1500), so
 * memory_limit never bounds the size of a blob. A `jb-` id is the first 40
 * of 64 hex chars of the sha256; the storage key and the row are per
 * account, the id string itself is not.
 *
 * Unreferenced blobs expire after a TTL (well above the RFC's 1-hour
 * minimum); re-uploading refreshes the expiry. Garbage collection lives in
 * JmapBlobGarbageCollector and honours domain reference checkers.
 */
final class JmapBlobService
{
    private const BLOB_ID_PREFIX = 'jb-';

    public const BLOB_ID_PATTERN = '/^jb-[0-9a-f]{40}$/';

    public function __construct(private readonly WgwStorage $storage) {}

    public static function maxSizeUpload(): int
    {
        return JmapBlobLimits::maxSizeUpload();
    }

    public static function blobIdFor(string $sha256): string
    {
        return self::BLOB_ID_PREFIX.substr($sha256, 0, 40);
    }

    public static function isBlobId(string $blobId): bool
    {
        return preg_match(self::BLOB_ID_PATTERN, $blobId) === 1;
    }

    /**
     * @return array{blobId: string, type: string, size: int}
     */
    public function store(string $username, string $mediaType, string $contents): array
    {
        if (strlen($contents) > self::maxSizeUpload()) {
            throw new ApiHttpException(400, 'Blob exceeds maxSizeUpload.', 'limit');
        }
        $stream = LocalDiskFiles::tempStream($contents);
        try {
            return $this->storeStream($username, $mediaType, $stream);
        } finally {
            fclose($stream);
        }
    }

    /**
     * Streams a part to storage, hashing it on the way.
     *
     * @param  resource  $stream
     * @return array{blobId: string, type: string, size: int, sha256: string}
     *
     * @throws BlobTooLargeException more than maxSizeUpload, or an empty body PHP discarded
     * @throws PartMismatchException stored length or sha256 differs from the declared one
     * @throws StorageFullException
     */
    public function storeStream(
        string $username,
        string $mediaType,
        $stream,
        ?int $declaredLength = null,
        ?string $declaredSha256 = null,
        bool $emptyMeansDiscarded = false,
    ): array {
        $disk = $this->storage->data();
        $tmpKey = $this->tmpKey($username);
        $digest = new StreamDigest(self::maxSizeUpload());
        $filter = HashingStreamFilter::attach($stream, $digest);
        try {
            $disk->writeStream($tmpKey, $stream);
        } catch (\Throwable $e) {
            $this->deleteQuietly($disk, $tmpKey);
            throw StorageFullException::fromThrowable($e) ?? $e;
        } finally {
            @stream_filter_remove($filter);
        }

        if ($digest->overflowed) {
            $this->deleteQuietly($disk, $tmpKey);
            throw new BlobTooLargeException('The part is larger than maxSizeUpload.');
        }
        if ($digest->bytes === 0 && $emptyMeansDiscarded) {
            // PHP empties an oversized POST body; never store that as a part.
            $this->deleteQuietly($disk, $tmpKey);
            throw new BlobTooLargeException('The request body was discarded because it exceeded post_max_size.');
        }

        $sha256 = $digest->hex();
        $mismatch = PartMismatchException::compare($declaredLength, $declaredSha256, $digest->bytes, $sha256);
        if ($mismatch !== null) {
            $this->deleteQuietly($disk, $tmpKey);
            throw $mismatch;
        }

        return $this->commitFile($username, $mediaType, $tmpKey, $sha256, $digest->bytes);
    }

    /**
     * Turns a fully written temporary file on the data disk into the
     * content-addressed blob (or drops it when that blob already exists)
     * and upserts the row with a fresh expiry.
     *
     * @return array{blobId: string, type: string, size: int, sha256: string}
     */
    public function commitFile(string $username, string $mediaType, string $tmpKey, string $sha256, int $size): array
    {
        $disk = $this->storage->data();
        $blobId = self::blobIdFor($sha256);
        $key = $this->blobKey($username, $blobId);
        if ($disk->exists($key)) {
            $this->deleteQuietly($disk, $tmpKey);
        } elseif (! $disk->move($tmpKey, $key)) {
            throw new \RuntimeException('Could not store the blob.');
        }

        $mediaType = trim($mediaType) === '' ? 'application/octet-stream' : trim($mediaType);
        JmapBlob::query()->updateOrCreate(
            ['username' => $username, 'blob_id' => $blobId],
            [
                'media_type' => $mediaType,
                'size_bytes' => $size,
                'sha256' => $sha256,
                'expires_at' => Carbon::now()->addHours(JmapBlobLimits::blobTtlHours()),
            ],
        );

        return ['blobId' => $blobId, 'type' => $mediaType, 'size' => $size, 'sha256' => $sha256];
    }

    /**
     * The blob row when both the row and its bytes exist.
     */
    public function find(string $username, string $blobId): ?JmapBlob
    {
        if (! self::isBlobId($blobId)) {
            return null;
        }
        $row = JmapBlob::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->first();
        if ($row === null || ! $this->storage->data()->exists($this->blobKey($username, $blobId))) {
            return null;
        }

        return $row;
    }

    /**
     * Read stream of a stored blob, or null.
     *
     * @return resource|null
     */
    public function openStream(string $username, string $blobId)
    {
        $key = $this->blobKey($username, $blobId);
        $disk = $this->storage->data();
        if (! $disk->exists($key)) {
            return null;
        }
        $stream = $disk->readStream($key);

        return is_resource($stream) ? $stream : null;
    }

    /**
     * Small blobs only (note markdown, contacts media): the whole blob as a
     * string. Drive content never goes through here.
     *
     * @return array{contents: string, mediaType: string, size: int}|null
     */
    public function retrieve(string $username, string $blobId): ?array
    {
        $row = $this->find($username, $blobId);
        if ($row === null) {
            return null;
        }
        $contents = $this->storage->data()->get($this->blobKey($username, $blobId));
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

    /**
     * Streamed variant for /jmap/download: the bytes are never read into a
     * PHP string.
     */
    public function retrieveContent(string $username, string $blobId): ?BlobContent
    {
        $row = $this->find($username, $blobId);
        if ($row === null) {
            return null;
        }
        $key = $this->blobKey($username, $blobId);
        $disk = $this->storage->data();

        return new BlobContent(
            is_string($row->media_type) && $row->media_type !== '' ? $row->media_type : 'application/octet-stream',
            static function () use ($disk, $key) {
                try {
                    return $disk->readStream($key);
                } catch (\Throwable) {
                    // Gone between resolving and streaming.
                    return null;
                }
            },
        );
    }

    public function delete(string $username, string $blobId): void
    {
        $this->deleteQuietly($this->storage->data(), $this->blobKey($username, $blobId));
        JmapBlob::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->delete();
    }

    public function blobKey(string $username, string $blobId): string
    {
        return 'jmap/blobs/'.$username.'/'.$blobId;
    }

    public function tmpKey(string $username): string
    {
        return 'jmap/tmp/'.$username.'/'.Str::lower(Str::random(32));
    }

    public function deleteQuietly(Filesystem $disk, string $key): void
    {
        try {
            if ($disk->exists($key)) {
                $disk->delete($key);
            }
        } catch (\Throwable) {
            // Best effort: an orphaned temp file is swept by the GC.
        }
    }
}
