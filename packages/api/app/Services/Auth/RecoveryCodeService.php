<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\MfaRecoveryCode;
use Illuminate\Support\Carbon;

final class RecoveryCodeService
{
    public const string CHARSET = 'abcdefghjkmnpqrstuvwxyz23456789';

    public static function normalize(string $raw): string
    {
        return strtolower(str_replace(['-', ' '], '', trim($raw)));
    }

    public static function hashNormalized(string $normalized): string
    {
        return hash('sha256', $normalized);
    }

    public function remaining(string $username): int
    {
        return MfaRecoveryCode::query()
            ->where('username', strtolower(trim($username)))
            ->whereNull('used_at')
            ->count();
    }

    /**
     * @return list<string>
     */
    public function replaceAll(string $username): array
    {
        $username = strtolower(trim($username));
        MfaRecoveryCode::query()->where('username', $username)->delete();

        $codes = [];
        $now = Carbon::now();
        for ($i = 0; $i < 10; $i++) {
            $plain = $this->generatePlaintext();
            $codes[] = $plain;
            MfaRecoveryCode::query()->create([
                'username' => $username,
                'code_hash' => self::hashNormalized(self::normalize($plain)),
                'created_at' => $now,
            ]);
        }

        return $codes;
    }

    public function consume(string $username, string $raw): bool
    {
        $normalized = self::normalize($raw);
        if (strlen($normalized) !== 10) {
            return false;
        }

        $updated = MfaRecoveryCode::query()
            ->where('username', strtolower(trim($username)))
            ->where('code_hash', self::hashNormalized($normalized))
            ->whereNull('used_at')
            ->update(['used_at' => Carbon::now()]);

        return $updated === 1;
    }

    public function deleteAll(string $username): void
    {
        MfaRecoveryCode::query()->where('username', strtolower(trim($username)))->delete();
    }

    private function generatePlaintext(): string
    {
        $chars = '';
        $max = strlen(self::CHARSET) - 1;
        for ($i = 0; $i < 10; $i++) {
            $chars .= self::CHARSET[random_int(0, $max)];
        }

        return substr($chars, 0, 5).'-'.substr($chars, 5, 5);
    }
}
