<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * A resolved blob whose bytes are read as a stream (#1500): the media type
 * plus an opener. Nothing reads the blob into a PHP string, so memory use
 * does not grow with the blob's size; the size comes from the opened stream
 * at stream time, not from a stored value that can be stale.
 */
final class BlobContent
{
    /**
     * @param  \Closure(): mixed  $opener  returns a readable stream resource, or null
     * @param  bool  $immutable  true when the blobId can never name other bytes
     *                           (a true content hash or a write-once id), so
     *                           it is a strong ETag and may be cached for good;
     *                           false for a hash-pending FileNode's provisional id
     */
    public function __construct(
        public readonly string $mediaType,
        private readonly \Closure $opener,
        public readonly bool $immutable = false,
    ) {}

    /**
     * For small stores that keep their bytes inline and never rewrite them
     * under the same id (contacts media).
     */
    public static function fromString(string $contents, string $mediaType): self
    {
        return new self($mediaType, static function () use ($contents) {
            $stream = tmpfile();
            if ($stream === false) {
                return null;
            }
            fwrite($stream, $contents);
            rewind($stream);

            return $stream;
        }, true);
    }

    /**
     * Strong ETag for downloads of $blobId, or null when its bytes can still
     * change under it (a resumed download must not mix two versions).
     */
    public function etag(string $blobId): ?string
    {
        return $this->immutable && preg_match('/^[A-Za-z0-9_-]+$/', $blobId) === 1 ? '"'.$blobId.'"' : null;
    }

    /**
     * @return resource|null
     */
    public function open()
    {
        $stream = ($this->opener)();

        return is_resource($stream) ? $stream : null;
    }
}
