<?php

declare(strict_types=1);

namespace App\Services\Drive;

/**
 * The caller may not reach this drive path. REST answers it like a missing path (404),
 * so the status never tells whether something exists where the caller cannot look.
 */
final class DriveAccessDeniedException extends \InvalidArgumentException
{
    public function __construct()
    {
        parent::__construct('Access denied for this path.');
    }
}
