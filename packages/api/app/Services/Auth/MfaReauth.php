<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;

final class MfaReauth
{
    public function __construct(
        private UserMfaService $mfa,
        private TotpService $totp,
        private SabreCredentialValidator $credentials,
        private MfaCodeFailCounter $codeFails,
        private LoginRateLimiter $loginLimiter,
    ) {}

    public function assert(string $username, ?string $password, ?string $code): void
    {
        $username = strtolower(trim($username));
        if ($this->mfa->isEnabled($username)) {
            if (trim((string) $password) !== '') {
                throw new ApiHttpException(
                    422,
                    'Account password is not accepted while two-factor authentication is on.',
                    'mfa_code_required',
                );
            }
            $this->assertCode($username, $code);

            return;
        }

        $password = trim((string) $password);
        if ($password === '') {
            throw new ApiHttpException(422, 'Account password is required.', 'bad_request');
        }
        if (! $this->loginLimiter->allow($username, (string) request()->ip())) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }
        $realm = (string) AppSetting::getValue('auth_realm', (string) config('wgw.auth_realm'));
        if (! $this->credentials->validate($username, $password, $realm)) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }
    }

    private function assertCode(string $username, ?string $code): void
    {
        if ($this->codeFails->isLocked($username)) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }

        $normalized = preg_replace('/\s+/', '', (string) $code) ?? '';
        if ($normalized === '') {
            throw new ApiHttpException(422, 'A current authenticator code is required.', 'mfa_code_required');
        }

        $result = $this->totp->consumeLive($username, $normalized);
        if ($result === 'reused') {
            throw new ApiHttpException(401, TotpService::REUSED_MESSAGE, 'totp_step_reused');
        }
        if ($result !== 'ok') {
            if ($this->codeFails->recordFailure($username)) {
                throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
            }
            throw new ApiHttpException(401, 'Invalid code.', 'unauthorized');
        }
    }
}
