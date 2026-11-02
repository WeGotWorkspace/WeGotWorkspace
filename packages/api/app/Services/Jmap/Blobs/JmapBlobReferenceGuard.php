<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

/**
 * The registered reference checkers as one veto: a blob some domain still
 * needs is never deleted — not by the GC, not by part cleanup after an
 * assembly step, and not moved away by an attach.
 */
final class JmapBlobReferenceGuard
{
    /**
     * @param  list<JmapBlobReferenceCheckerInterface>  $checkers
     */
    public function __construct(private readonly array $checkers) {}

    public function isReferenced(string $username, string $blobId): bool
    {
        foreach ($this->checkers as $checker) {
            if ($checker->isReferenced($username, $blobId)) {
                return true;
            }
        }

        return false;
    }
}
