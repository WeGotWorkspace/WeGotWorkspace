<?php

declare(strict_types=1);

namespace App\Storage\Streams;

/**
 * Read filter that feeds every octet passing through a stream into a
 * StreamDigest (sha256 + byte count) — so a write hashes the bytes while
 * Flysystem streams them, and nothing is ever held as a whole PHP string.
 *
 * Once the digest's limit is exceeded the filter stops passing data on and
 * marks the digest as overflowed; the caller deletes the partial write.
 */
final class HashingStreamFilter extends \php_user_filter
{
    public const NAME = 'wgw.sha256';

    private static bool $registered = false;

    /**
     * @param  resource  $stream
     * @return resource the filter handle (for stream_filter_remove)
     */
    public static function attach($stream, StreamDigest $digest)
    {
        if (! self::$registered) {
            stream_filter_register(self::NAME, self::class);
            self::$registered = true;
        }
        $filter = stream_filter_append($stream, self::NAME, STREAM_FILTER_READ, $digest);
        if ($filter === false) {
            throw new \RuntimeException('Could not attach the hashing filter.');
        }

        return $filter;
    }

    /**
     * @param  resource  $in
     * @param  resource  $out
     * @param  int  $consumed
     */
    public function filter($in, $out, &$consumed, bool $closing): int
    {
        $digest = $this->params;
        if (! $digest instanceof StreamDigest) {
            return PSFS_ERR_FATAL;
        }
        while ($bucket = stream_bucket_make_writeable($in)) {
            $consumed += $bucket->datalen;
            if ($digest->overflowed) {
                continue;
            }
            if (! $digest->accept((string) $bucket->data)) {
                continue;
            }
            stream_bucket_append($out, $bucket);
        }

        return PSFS_PASS_ON;
    }
}
