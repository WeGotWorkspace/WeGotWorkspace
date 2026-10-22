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
     */
    public function __construct(
        public readonly string $mediaType,
        private readonly \Closure $opener,
    ) {}

    /**
     * For small stores that keep their bytes inline (contacts media).
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
        });
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
