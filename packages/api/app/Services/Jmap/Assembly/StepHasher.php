<?php

declare(strict_types=1);

namespace App\Services\Jmap\Assembly;

use App\Services\Jmap\Blobs\HashStateCodec;
use Illuminate\Contracts\Filesystem\Filesystem;

/**
 * Resumable sha256 over a file that is read in budgeted steps (#1500):
 * shared by the assembly hash rebuild and the hash jobs of files discovered
 * on disk. No call reads more than its budget.
 */
final class StepHasher
{
    private const CHUNK = 1024 * 1024;

    /**
     * Restores the stored context, or starts over at 0 when the stored
     * state cannot be used (corrupt, another build, not a HashContext).
     *
     * @return array{0: \HashContext, 1: int} context and the offset it covers
     */
    public static function resume(?string $state, ?string $build, int $hashedBytes): array
    {
        $context = HashStateCodec::decode($state, $build);
        if ($context === null) {
            return [hash_init('sha256'), 0];
        }

        return [$context, max(0, $hashedBytes)];
    }

    /**
     * Hashes bytes [$from, min($until, $from + $budget)) of the file into
     * $context and returns the new offset.
     */
    public static function advance(Filesystem $disk, string $key, \HashContext $context, int $from, int $until, int $budget): int
    {
        if ($from >= $until || $budget <= 0) {
            return $from;
        }
        $stream = $disk->readStream($key);
        if (! is_resource($stream)) {
            throw new \RuntimeException('Could not read the file to hash.');
        }
        try {
            if ($from > 0 && fseek($stream, $from) !== 0) {
                // Non-seekable stream: skip forward by reading.
                $skip = $from;
                while ($skip > 0 && ! feof($stream)) {
                    $read = fread($stream, min(self::CHUNK, $skip));
                    if ($read === false || $read === '') {
                        break;
                    }
                    $skip -= strlen($read);
                }
            }
            $remaining = min($until - $from, $budget);
            $offset = $from;
            while ($remaining > 0 && ! feof($stream)) {
                $chunk = fread($stream, min(self::CHUNK, $remaining));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                hash_update($context, $chunk);
                $offset += strlen($chunk);
                $remaining -= strlen($chunk);
            }
        } finally {
            fclose($stream);
        }

        return $offset;
    }
}
