<?php

declare(strict_types=1);

namespace App\Services\Collab;

/**
 * The one header name for "the stored Yjs state is not an ancestor of the
 * text". Notes and Docs both send it on their `?format=yjs` read.
 */
final class CollabExternalWrite
{
    public const HEADER = 'X-Wgw-External-Write';
}
