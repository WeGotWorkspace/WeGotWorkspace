<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\ApiRevokedToken;

final class RevokedTokenRepository
{
    public function revoke(string $jti, int $exp): void
    {
        $this->cleanupExpired();
        ApiRevokedToken::query()->updateOrInsert(
            ['jti' => $jti],
            ['expires_at' => $exp, 'created_at' => time()]
        );
    }

    public function isRevoked(string $jti): bool
    {
        return ApiRevokedToken::query()->where('jti', $jti)->where('expires_at', '>', time())->exists();
    }

    private function cleanupExpired(): void
    {
        ApiRevokedToken::query()->where('expires_at', '<=', time())->delete();
    }
}
