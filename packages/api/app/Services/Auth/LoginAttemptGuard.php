<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;

final class LoginAttemptGuard
{
    public function __construct(
        private LoginRateLimiter $ipLimiter,
        private MfaCodeFailCounter $codeFails,
    ) {}

    public function assertPasswordAttempt(string $username, string $ip): void
    {
        if ($this->codeFails->isLocked($username)) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }
        if (! $this->ipLimiter->allow($username, $ip)) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }
    }

    public function succeed(string $username, string $ip): void
    {
        $this->ipLimiter->reset($username, $ip);
        $this->codeFails->clear($username);
    }
}
