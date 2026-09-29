<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppPassword;
use Illuminate\Support\Carbon;

final class AppPasswordService
{
    private const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

    private const TOUCH_INTERVAL_SECONDS = 300;

    public static function normalize(string $raw): string
    {
        return strtolower(str_replace(['-', ' '], '', trim($raw)));
    }

    public static function hashNormalized(string $normalized): string
    {
        return hash('sha256', $normalized);
    }

    public function generatePlaintext(): string
    {
        $chars = '';
        $max = strlen(self::ALPHABET) - 1;
        for ($i = 0; $i < 16; $i++) {
            $chars .= self::ALPHABET[random_int(0, $max)];
        }

        return substr($chars, 0, 4).'-'.substr($chars, 4, 4).'-'.substr($chars, 8, 4).'-'.substr($chars, 12, 4);
    }

    /**
     * @return list<array{id: int, name: string, createdAt: string, lastUsedAt: string|null, lastUsedClient: string|null}>
     */
    public function listFor(string $username): array
    {
        return AppPassword::query()
            ->where('username', strtolower(trim($username)))
            ->whereNull('revoked_at')
            ->orderByDesc('id')
            ->get()
            ->map(fn (AppPassword $row): array => $this->summary($row))
            ->all();
    }

    /**
     * @return array{password: string, item: array{id: int, name: string, createdAt: string, lastUsedAt: string|null, lastUsedClient: string|null}}
     */
    public function create(string $username, string $name): array
    {
        $username = strtolower(trim($username));
        $plain = $this->generatePlaintext();
        $row = AppPassword::query()->create([
            'username' => $username,
            'name' => $name,
            'token_hash' => self::hashNormalized(self::normalize($plain)),
            'created_at' => Carbon::now(),
        ]);

        return [
            'password' => $plain,
            'item' => $this->summary($row),
        ];
    }

    public function revoke(string $username, int $id): void
    {
        $updated = AppPassword::query()
            ->where('id', $id)
            ->where('username', strtolower(trim($username)))
            ->whereNull('revoked_at')
            ->update(['revoked_at' => Carbon::now()]);
        if ($updated === 0) {
            throw new ApiHttpException(404, 'App password not found.', 'not_found');
        }
    }

    public function revokeAll(string $username): void
    {
        $username = strtolower(trim($username));
        AppPassword::query()
            ->where('username', $username)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => Carbon::now()]);
    }

    /**
     * Match an active app password and touch last-used at most once per five minutes.
     */
    public function matches(string $username, string $password, ?string $client): bool
    {
        $normalized = self::normalize($password);
        if (strlen($normalized) !== 16 || ! ctype_lower($normalized)) {
            return false;
        }
        $username = strtolower(trim($username));
        $hash = self::hashNormalized($normalized);
        $row = AppPassword::query()
            ->where('username', $username)
            ->where('token_hash', $hash)
            ->whereNull('revoked_at')
            ->first();
        if ($row === null || ! hash_equals((string) $row->token_hash, $hash)) {
            return false;
        }

        $clientLabel = $this->clientLabel($client);
        $threshold = Carbon::now()->subSeconds(self::TOUCH_INTERVAL_SECONDS);
        AppPassword::query()
            ->where('id', $row->id)
            ->where(function ($query) use ($threshold): void {
                $query->whereNull('last_used_at')->orWhere('last_used_at', '<', $threshold);
            })
            ->update([
                'last_used_at' => Carbon::now(),
                'last_used_client' => $clientLabel,
            ]);

        return true;
    }

    public function userHasAny(string $username): bool
    {
        return AppPassword::query()
            ->where('username', strtolower(trim($username)))
            ->whereNull('revoked_at')
            ->exists();
    }

    private function clientLabel(?string $client): ?string
    {
        if ($client === null) {
            return null;
        }
        $trimmed = trim($client);
        if ($trimmed === '') {
            return null;
        }

        return substr($trimmed, 0, 120);
    }

    /**
     * @return array{id: int, name: string, createdAt: string, lastUsedAt: string|null, lastUsedClient: string|null}
     */
    private function summary(AppPassword $row): array
    {
        return [
            'id' => (int) $row->id,
            'name' => (string) $row->name,
            'createdAt' => $row->created_at?->toIso8601String() ?? '',
            'lastUsedAt' => $row->last_used_at?->toIso8601String(),
            'lastUsedClient' => $row->last_used_client,
        ];
    }
}
