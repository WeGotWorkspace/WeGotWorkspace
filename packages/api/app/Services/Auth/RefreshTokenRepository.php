<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\ApiRefreshToken;

final class RefreshTokenRepository
{
    public function __construct(private UserEnabledGuard $enabled) {}

    public function refreshTtl(): int
    {
        return max(3600, (int) config('wgw.jwt.refresh_ttl'));
    }

    /**
     * @param  'guest'|'user'|'admin'  $role
     */
    public function issue(string $username, string $role, int $generation = 0): string
    {
        $this->cleanupExpired();
        $token = bin2hex(random_bytes(32));
        $hash = hash('sha256', $token);
        $expiresAt = time() + $this->refreshTtl();

        ApiRefreshToken::query()->updateOrInsert(
            ['token_hash' => $hash],
            [
                'username' => $username,
                'role' => $role,
                'expires_at' => $expiresAt,
                'revoked' => 0,
                'created_at' => time(),
                'session_generation' => $generation,
            ]
        );

        return $token;
    }

    /**
     * @return array{username: string, role: 'guest'|'user'|'admin'}|null
     */
    public function consume(string $token): ?array
    {
        $this->cleanupExpired();
        $hash = hash('sha256', $token);
        $row = ApiRefreshToken::query()->where('token_hash', $hash)->first();
        if ($row === null) {
            return null;
        }
        if ((int) $row->expires_at <= time()) {
            ApiRefreshToken::query()->where('token_hash', $hash)->delete();

            return null;
        }
        if ((int) $row->revoked === 1) {
            // RFC 9700: reuse of a rotated token signals theft; revoke entire chain
            $this->revokeAllForUsername((string) $row->username);

            return null;
        }
        $generation = $this->enabled->status((string) $row->username)['generation'];
        if ((int) $row->session_generation !== $generation) {
            ApiRefreshToken::query()->where('token_hash', $hash)->update(['revoked' => 1]);

            return null;
        }

        ApiRefreshToken::query()->where('token_hash', $hash)->update(['revoked' => 1]);
        $role = (string) $row->role;
        if (! in_array($role, ['guest', 'user', 'admin'], true)) {
            return null;
        }

        return [
            'username' => (string) $row->username,
            'role' => $role,
        ];
    }

    public function revoke(string $token): void
    {
        $this->cleanupExpired();
        $hash = hash('sha256', $token);
        ApiRefreshToken::query()->where('token_hash', $hash)->update(['revoked' => 1]);
    }

    public function revokeAllForUsername(string $username): void
    {
        $this->cleanupExpired();
        ApiRefreshToken::query()->where('username', $username)->update(['revoked' => 1]);
    }

    private function cleanupExpired(): void
    {
        ApiRefreshToken::query()->where('expires_at', '<=', time())->delete();
    }
}
