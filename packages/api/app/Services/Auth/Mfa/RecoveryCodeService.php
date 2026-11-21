<?php

declare(strict_types=1);

namespace App\Services\Auth\Mfa;

use App\Models\MfaRecoveryCode;
use Illuminate\Support\Carbon;

/**
 * Ten recovery codes per user. Each is 8 bytes from `random_bytes`, written as
 * 16 lowercase hex characters in groups of four; only the sha256 of the code
 * with separators stripped is stored.
 */
final class RecoveryCodeService
{
    public const int COUNT = 10;

    public static function hashNormalized(string $code): string
    {
        return hash('sha256', self::normalize($code));
    }

    private static function normalize(string $code): string
    {
        return strtolower((string) preg_replace('/[\s-]+/', '', $code));
    }

    /**
     * Deletes the old set and returns the new one, shown once.
     *
     * @return list<string>
     */
    public function replaceAll(string $username): array
    {
        $username = strtolower(trim($username));
        MfaRecoveryCode::query()->where('username', $username)->delete();

        $codes = [];
        $now = Carbon::now();
        for ($i = 0; $i < self::COUNT; $i++) {
            $code = implode('-', str_split(bin2hex(random_bytes(8)), 4));
            $codes[] = $code;
            MfaRecoveryCode::query()->create([
                'username' => $username,
                'code_hash' => self::hashNormalized($code),
                'created_at' => $now,
            ]);
        }

        return $codes;
    }

    /**
     * Spends an unused code of this user. False for anything else.
     */
    public function consume(string $username, string $code): bool
    {
        if (preg_match('/^[a-f0-9]{16}$/', self::normalize($code)) !== 1) {
            return false;
        }

        return MfaRecoveryCode::query()
            ->where('username', strtolower(trim($username)))
            ->where('code_hash', self::hashNormalized($code))
            ->whereNull('used_at')
            ->update(['used_at' => Carbon::now()]) === 1;
    }

    public function remaining(string $username): int
    {
        return MfaRecoveryCode::query()
            ->where('username', strtolower(trim($username)))
            ->whereNull('used_at')
            ->count();
    }

    public function deleteAll(string $username): void
    {
        MfaRecoveryCode::query()->where('username', strtolower(trim($username)))->delete();
    }
}
