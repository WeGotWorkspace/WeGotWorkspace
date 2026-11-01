<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * The stored part differs from the length or sha256 the client declared
 * (Wgw-Part-Length / Wgw-Part-Sha256): a truncated or corrupted part is
 * rejected, never stored, so it cannot reach an assembly.
 */
final class PartMismatchException extends \RuntimeException
{
    /**
     * @param  array<string, int|string|list<string>>  $details
     */
    public function __construct(public readonly array $details)
    {
        parent::__construct('The stored part does not match its declared length or sha256.');
    }

    public static function compare(?int $declaredLength, ?string $declaredSha256, int $length, string $sha256): ?self
    {
        $mismatch = [];
        $details = [];
        if ($declaredLength !== null && $declaredLength !== $length) {
            $mismatch[] = 'length';
            $details['expectedLength'] = $declaredLength;
            $details['receivedLength'] = $length;
        }
        if ($declaredSha256 !== null && ! hash_equals(strtolower($declaredSha256), $sha256)) {
            $mismatch[] = 'sha256';
            $details['expectedSha256'] = strtolower($declaredSha256);
            $details['receivedSha256'] = $sha256;
        }

        return $mismatch === [] ? null : new self(['mismatch' => $mismatch] + $details);
    }
}
