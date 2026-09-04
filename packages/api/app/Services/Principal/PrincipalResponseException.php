<?php

declare(strict_types=1);

namespace App\Services\Principal;

use RuntimeException;

final class PrincipalResponseException extends RuntimeException
{
    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(
        public readonly int $status,
        public readonly array $payload,
    ) {
        parent::__construct((string) ($payload['error'] ?? 'principal_error'));
    }
}
