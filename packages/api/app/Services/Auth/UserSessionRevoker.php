<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\PushSubscription;
use App\Models\User;
use Laravel\Passport\Passport;

/**
 * Drops bearer refresh tokens, Passport grants, and push subscriptions for one user.
 *
 * Pass $exceptRefreshTokenHash to leave that still-valid refresh token in place.
 * An already revoked hash is not restored. Each call bumps ui_session_epoch.
 */
final class UserSessionRevoker
{
    public function __construct(private RefreshTokenRepository $refreshTokens) {}

    public function revokeAll(string $username, ?string $exceptRefreshTokenHash = null): void
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return;
        }

        $exceptHash = ($exceptRefreshTokenHash !== null && $exceptRefreshTokenHash !== '')
            ? $exceptRefreshTokenHash
            : null;
        $this->refreshTokens->revokeAllForUsername($username, $exceptHash);

        $user = User::query()->where('username', $username)->first();
        if ($user !== null) {
            $tokens = Passport::token()->newQuery()
                ->where('user_id', $user->getAuthIdentifier())
                ->where('revoked', false)
                ->get();
            if ($tokens->isNotEmpty()) {
                $ids = $tokens->modelKeys();
                Passport::token()->newQuery()->whereIn('id', $ids)->update(['revoked' => true]);
                Passport::refreshToken()->newQuery()->whereIn('access_token_id', $ids)->update(['revoked' => true]);
            }
        }

        PushSubscription::query()->where('principal', $username)->delete();
        $this->bumpEpoch($username);
    }

    public function bumpEpoch(string $username): void
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return;
        }

        User::query()->where('username', $username)->increment('ui_session_epoch');
    }
}
