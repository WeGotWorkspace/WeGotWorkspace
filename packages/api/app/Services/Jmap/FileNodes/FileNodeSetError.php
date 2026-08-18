<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

/**
 * A per-record SetError inside FileNode/set (RFC 8620 §5.3 shape plus the
 * draft-14 extras: alreadyExists carries existingId, nodeHasChildren for
 * refused directory destroys).
 */
final class FileNodeSetError extends \RuntimeException
{
    /**
     * @param  array<string, mixed>  $shape
     */
    public function __construct(public readonly array $shape)
    {
        parent::__construct((string) ($shape['description'] ?? ($shape['type'] ?? 'setError')));
    }
}
