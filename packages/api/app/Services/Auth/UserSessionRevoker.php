<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\ApiRefreshToken;
use App\Models\PushSubscription;
use App\Models\User;
use Laravel\Passport\Passport;

/**
 * Drops bearer refresh tokens, Passport grants, and push subscriptions for one user.
 *
 * #1145 adds the UI-cookie epoch bump here. Pass $exceptRefreshTokenHash to keep
 * the caller's current refresh token.
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

        $this->refreshTokens->revokeAllForUsername($username);
        if ($exceptRefreshTokenHash !== null && $exceptRefreshTokenHash !== '') {
            ApiRefreshToken::query()
                ->where('token_hash', $exceptRefreshTokenHash)
                ->where('username', $username)
                ->update(['revoked' => 0]);
        }

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
    }
}
