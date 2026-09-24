<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use RuntimeException;
use Throwable;

final class CimdException extends RuntimeException
{
    public function __construct(string $message, private int $status = 400, ?Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }

    public function status(): int
    {
        return $this->status;
    }
}
