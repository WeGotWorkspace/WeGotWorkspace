<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;

final class MfaSessionReissue
{
    public function __construct(private RefreshTokenRepository $refreshTokens) {}

    public function afterAuthenticatorChanged(string $username): void
    {
        $username = strtolower(trim($username));
        User::query()->where('username', $username)->increment('session_generation');
        $this->refreshTokens->revokeAllForUsername($username);
    }
}
