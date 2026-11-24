<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Exceptions\ApiHttpException;
use App\Services\Auth\LoginRateLimiter;

/**
 * Re-authentication with a current authenticator code on a signed-in session
 * (#2273): turning two-factor off, new recovery codes, and creating an app
 * password while two-factor is on. Authenticator codes only, never a recovery
 * code. The sign-in limit of user and address, the per-user code lock and the
 * replay guard (`last_used_step`) all apply; a spent code is refused first and
 * does not count; a wrong code is 403 because the session itself is valid.
 */
final class CurrentCodeCheck
{
    public function __construct(
        private MfaCodeCheck $codes,
        private LoginRateLimiter $limiter,
    ) {}

    public function assert(string $username, string $code, string $ip): void
    {
        if (! $this->limiter->allow($username, $ip)) {
            throw LoginRateLimiter::throttled($this->limiter->retryAfter($username, $ip));
        }
        // A spent code is no guess: refuse it with the same answer, uncounted.
        if ($this->codes->isSpentTotp($username, $code)) {
            throw self::wrongCode();
        }
        if (! $this->codes->acceptTotp($username, $code)) {
            $this->limiter->hit($username, $ip);

            throw self::wrongCode();
        }
        $this->limiter->reset($username, $ip);
    }

    public static function wrongCode(): ApiHttpException
    {
        return new ApiHttpException(403, 'That code is not right. Check the time on your phone and try again.', 'mfa_code_invalid');
    }
}
