<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\ApiRefreshToken;
use Closure;
use Illuminate\Support\Str;
use LogicException;

final class RefreshTokenRepository
{
    /** Reuse inside this window replays the successor. Outside it, reuse is theft. */
    public const ROTATION_GRACE_SECONDS = 60;

    public function __construct() {}

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }

    public function refreshTtl(): int
    {
        return max(3600, (int) config('wgw.jwt.refresh_ttl'));
    }

    /**
     * @param  'guest'|'user'|'admin'  $role
     */
    public function issue(string $username, string $role, ?string $familyId = null): string
    {
        $this->cleanupExpired();
        $token = bin2hex(random_bytes(32));
        $familyId = $familyId !== null && $familyId !== '' ? $familyId : (string) Str::ulid();

        ApiRefreshToken::query()->updateOrInsert(
            ['token_hash' => self::hashToken($token)],
            [
                'username' => $username,
                'role' => $role,
                'expires_at' => time() + $this->refreshTtl(),
                'revoked' => 0,
                'created_at' => time(),
                'family_id' => $familyId,
                'rotated_at' => null,
                'successor_hash' => null,
                'successor_token' => null,
            ],
        );

        return $token;
    }

    /**
     * Redeem a refresh token. A live token is rotated through $issueSuccessor.
     * Presenting it again inside the grace window returns that same successor
     * and does not rotate or revoke. Later reuse revokes the token family.
     *
     * @param  (Closure(string, string): string)|null  $issueSuccessor  (username, familyId): plaintext token
     * @return array{username: string, role: 'guest'|'user'|'admin', refresh_token: string}|null
     */
    public function consume(string $token, ?Closure $issueSuccessor = null): ?array
    {
        $this->cleanupExpired();
        $hash = self::hashToken($token);

        return ApiRefreshToken::query()->getConnection()->transaction(
            function () use ($hash, $issueSuccessor): ?array {
                $row = ApiRefreshToken::query()->where('token_hash', $hash)->lockForUpdate()->first();
                if ($row === null) {
                    return null;
                }
                if ((int) $row->expires_at <= time()) {
                    $row->delete();

                    return null;
                }
                if ((int) $row->revoked === 1) {
                    return $this->replayOrRevoke($row);
                }
                if ($issueSuccessor === null) {
                    throw new LogicException('Refresh token rotation requires a successor issuer.');
                }

                return $this->rotate($row, $issueSuccessor);
            },
        );
    }

    public function revoke(string $token): void
    {
        $this->cleanupExpired();
        ApiRefreshToken::query()
            ->where('token_hash', self::hashToken($token))
            ->update(['revoked' => 1]);
    }

    public function revokeAllForUsername(string $username): void
    {
        $this->cleanupExpired();
        ApiRefreshToken::query()->where('username', $username)->update(['revoked' => 1]);
    }

    public function revokeFamily(string $familyId): void
    {
        if ($familyId === '') {
            return;
        }

        $this->cleanupExpired();
        $this->markFamilyRevoked($familyId);
    }

    /**
     * @param  Closure(string, string): string  $issueSuccessor
     * @return array{username: string, role: 'guest'|'user'|'admin', refresh_token: string}|null
     */
    private function rotate(ApiRefreshToken $row, Closure $issueSuccessor): ?array
    {
        $familyId = $this->familyIdOf($row);
        $plain = $issueSuccessor((string) $row->username, $familyId);
        $successorHash = self::hashToken($plain);
        $claimed = ApiRefreshToken::query()
            ->where('token_hash', $row->token_hash)
            ->where('revoked', 0)
            ->update([
                'revoked' => 1,
                'rotated_at' => time(),
                'successor_hash' => $successorHash,
                'successor_token' => ApiRefreshToken::sealSuccessorToken($plain),
                'family_id' => $familyId,
            ]);

        if ($claimed !== 1) {
            return $this->loseRotationRace($row->token_hash, $successorHash);
        }

        $successor = ApiRefreshToken::query()->where('token_hash', $successorHash)->first();

        return $successor === null ? null : $this->pairFrom($successor, $plain);
    }

    /**
     * @return array{username: string, role: 'guest'|'user'|'admin', refresh_token: string}|null
     */
    private function loseRotationRace(string $presentedHash, string $orphanHash): ?array
    {
        ApiRefreshToken::query()->where('token_hash', $orphanHash)->delete();
        $fresh = ApiRefreshToken::query()->where('token_hash', $presentedHash)->lockForUpdate()->first();
        if ($fresh === null || (int) $fresh->revoked !== 1) {
            return null;
        }

        return $this->replayOrRevoke($fresh);
    }

    /**
     * @return array{username: string, role: 'guest'|'user'|'admin', refresh_token: string}|null
     */
    private function replayOrRevoke(ApiRefreshToken $row): ?array
    {
        if ($this->withinGrace($row)) {
            $successor = $this->liveSuccessor($row);
            $plain = $row->openSuccessorToken();
            if ($successor !== null && is_string($plain) && hash_equals($successor->token_hash, self::hashToken($plain))) {
                return $this->pairFrom($successor, $plain);
            }
        }

        $this->revokePresentedFamily($row);

        return null;
    }

    private function revokePresentedFamily(ApiRefreshToken $row): void
    {
        $familyId = is_string($row->family_id) ? $row->family_id : '';
        if ($familyId !== '') {
            $this->markFamilyRevoked($familyId);

            return;
        }

        $this->revokeAllForUsername((string) $row->username);
    }

    private function liveSuccessor(ApiRefreshToken $row): ?ApiRefreshToken
    {
        $hash = $row->successor_hash;
        if (! is_string($hash) || $hash === '') {
            return null;
        }

        $successor = ApiRefreshToken::query()->where('token_hash', $hash)->first();
        if ($successor === null || (int) $successor->revoked === 1 || (int) $successor->expires_at <= time()) {
            return null;
        }

        return $successor;
    }

    private function withinGrace(ApiRefreshToken $row): bool
    {
        if ($row->rotated_at === null) {
            return false;
        }

        return time() - (int) $row->rotated_at <= self::ROTATION_GRACE_SECONDS;
    }

    private function familyIdOf(ApiRefreshToken $row): string
    {
        $familyId = $row->family_id;

        return is_string($familyId) && $familyId !== '' ? $familyId : (string) Str::ulid();
    }

    /**
     * @return array{username: string, role: 'guest'|'user'|'admin', refresh_token: string}|null
     */
    private function pairFrom(ApiRefreshToken $successor, string $refreshToken): ?array
    {
        $role = (string) $successor->role;
        if (! in_array($role, ['guest', 'user', 'admin'], true)) {
            return null;
        }

        return [
            'username' => (string) $successor->username,
            'role' => $role,
            'refresh_token' => $refreshToken,
        ];
    }

    private function markFamilyRevoked(string $familyId): void
    {
        ApiRefreshToken::query()->where('family_id', $familyId)->update(['revoked' => 1]);
    }

    private function cleanupExpired(): void
    {
        $now = time();
        ApiRefreshToken::query()->where('expires_at', '<=', $now)->delete();
        ApiRefreshToken::query()
            ->whereNotNull('successor_token')
            ->where('rotated_at', '<', $now - self::ROTATION_GRACE_SECONDS)
            ->update(['successor_token' => null]);
    }
}
