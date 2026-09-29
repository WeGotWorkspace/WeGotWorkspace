<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AuthChallenge;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;

final class AuthChallengeService
{
    private const int TOTP_TTL_SECONDS = 300;

    private const int SETUP_TTL_SECONDS = 900;

    public function __construct(
        private UserMfaService $mfa,
        private MfaEnforcement $enforcement,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function beginAfterPassword(string $username, string $client = 'spa'): array
    {
        $username = strtolower(trim($username));
        $client = $client === 'oauth' ? 'oauth' : 'spa';
        if ($this->mfa->isEnabled($username)) {
            return [
                'status' => 'mfa_required',
                'challenge' => $this->issue($username, 'totp', $client),
                'methods' => ['totp', 'recovery'],
                'client' => $client,
            ];
        }
        if ($this->enforcement->isRequired()) {
            return [
                'status' => 'mfa_setup_required',
                'challenge' => $this->issue($username, 'totp_setup', $client),
                'client' => $client,
            ];
        }

        return [
            'status' => 'ok',
            'username' => $username,
        ];
    }

    public function issue(string $username, string $kind, string $client = 'spa'): string
    {
        $id = bin2hex(random_bytes(32));
        $ttl = $kind === 'totp' ? self::TOTP_TTL_SECONDS : self::SETUP_TTL_SECONDS;
        $username = strtolower(trim($username));
        AuthChallenge::query()->create([
            'id_hash' => hash('sha256', $id),
            'username' => $username,
            'kind' => $kind,
            'client' => $client === 'oauth' ? 'oauth' : 'spa',
            'attempts' => 0,
            'expires_at' => Carbon::now()->addSeconds($ttl),
            'created_at' => Carbon::now(),
        ]);
        Cache::put($this->ownerKey($id), $username, self::SETUP_TTL_SECONDS);

        return $id;
    }

    public function owner(string $plainId): ?string
    {
        $plainId = strtolower(trim($plainId));
        if (preg_match('/^[a-f0-9]{64}$/', $plainId) !== 1) {
            return null;
        }

        $hash = hash('sha256', $plainId);
        $row = AuthChallenge::query()->where('id_hash', $hash)->first();
        if ($row instanceof AuthChallenge) {
            return $row->username;
        }

        $cached = Cache::get($this->ownerKey($plainId));

        return is_string($cached) && $cached !== '' ? $cached : null;
    }

    public function findOpen(string $plainId): AuthChallenge
    {
        $plainId = strtolower(trim($plainId));
        if (preg_match('/^[a-f0-9]{64}$/', $plainId) !== 1) {
            throw new ApiHttpException(401, 'Invalid or expired challenge.', 'unauthorized');
        }

        $hash = hash('sha256', $plainId);
        $row = AuthChallenge::query()->where('id_hash', $hash)->first();
        if (! $row instanceof AuthChallenge || ! hash_equals((string) $row->id_hash, $hash)) {
            throw new ApiHttpException(401, 'Invalid or expired challenge.', 'unauthorized');
        }
        if ($row->consumed_at !== null || $row->expires_at->lessThanOrEqualTo(Carbon::now())) {
            throw new ApiHttpException(401, 'Invalid or expired challenge.', 'unauthorized');
        }

        return $row;
    }

    private function ownerKey(string $plainId): string
    {
        return 'mfa-challenge-owner:'.hash('sha256', strtolower(trim($plainId)));
    }
}
