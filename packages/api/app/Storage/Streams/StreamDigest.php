<?php

declare(strict_types=1);

namespace App\Storage\Streams;

/**
 * Running sha256 and byte count of a stream, with an optional byte limit.
 */
final class StreamDigest
{
    public int $bytes = 0;

    public bool $overflowed = false;

    private \HashContext $context;

    private ?string $final = null;

    public function __construct(public readonly ?int $limit = null, ?\HashContext $context = null)
    {
        $this->context = $context ?? hash_init('sha256');
    }

    /**
     * Feeds a chunk; returns false (and marks the digest overflowed) when
     * the chunk would take the byte count past the limit.
     */
    public function accept(string $chunk): bool
    {
        $length = strlen($chunk);
        if ($this->limit !== null && $this->bytes + $length > $this->limit) {
            $this->overflowed = true;

            return false;
        }
        hash_update($this->context, $chunk);
        $this->bytes += $length;

        return true;
    }

    public function context(): \HashContext
    {
        return $this->context;
    }

    /**
     * Finalizes once; later calls return the stored hex (a finalized
     * HashContext cannot be finalized again).
     */
    public function hex(): string
    {
        return $this->final ??= hash_final($this->context);
    }
}
