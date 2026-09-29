<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;

final class PasswordLogin
{
    public function __construct(
        private LoginAttemptGuard $attempts,
        private SabreCredentialValidator $credentials,
        private AuthChallengeService $challenges,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function accept(string $username, string $password, string $ip): array
    {
        $username = strtolower(trim($username));
        if ($username === '' || $password === '') {
            throw new ApiHttpException(400, 'Username and password are required.', 'bad_request');
        }

        $this->attempts->assertPasswordAttempt($username, $ip);
        $realm = (string) AppSetting::getValue('auth_realm', (string) config('wgw.auth_realm'));
        if (! $this->credentials->validate($username, $password, $realm)) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        $next = $this->challenges->beginAfterPassword($username);
        if ($next['status'] === 'ok') {
            $this->attempts->succeed($username, $ip);
        }

        return $next;
    }
}
