<?php

declare(strict_types=1);

namespace App\Services\Collab;

use RuntimeException;

/** Rejected Yjs REST payload. Callers map this onto their own HTTP error shape. */
final class YjsPayloadException extends RuntimeException
{
    public function __construct(
        public readonly string $error,
        public readonly int $status,
    ) {
        parent::__construct($error);
    }
}
