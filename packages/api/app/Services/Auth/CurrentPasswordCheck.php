<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;

/**
 * Re-authentication on a signed-in session: the account password, on the web
 * sign-in rate limit. An app password is never accepted here.
 */
final class CurrentPasswordCheck
{
    public function __construct(
        private SabreCredentialValidator $credentials,
        private LoginRateLimiter $loginLimiter,
    ) {}

    public function assert(string $username, mixed $submitted, string $ip): void
    {
        if (! $this->loginLimiter->allow($username, $ip)) {
            throw new ApiHttpException(
                429,
                'Too many login attempts. Please try again later.',
                'throttled',
                headers: ['Retry-After' => $this->loginLimiter->retryAfter($username, $ip)],
            );
        }

        $currentPassword = is_string($submitted) ? $submitted : '';
        $realm = (string) AppSetting::getValue('auth_realm', (string) config('wgw.auth_realm'));
        if ($currentPassword === '' || ! $this->credentials->validate($username, $currentPassword, $realm)) {
            $this->loginLimiter->hit($username, $ip);
            throw new ApiHttpException(403, 'Current password is incorrect.', 'current_password_invalid');
        }

        $this->loginLimiter->reset($username, $ip);
    }
}
