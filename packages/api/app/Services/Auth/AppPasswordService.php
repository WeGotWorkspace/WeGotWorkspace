<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppPassword;
use Illuminate\Support\Carbon;

/**
 * Named app passwords for DAV and Meet Basic sign-in (#2271).
 *
 * The plaintext is 16 random lowercase letters (about 75 bits), returned once.
 * Only {@see hashNormalized()} hashes it, after whitespace is stripped, so a
 * password typed in groups of four matches. A match is one indexed lookup on
 * (username, token_hash); nothing about an app password goes into the DAV verified-password
 * memory.
 */
final class AppPasswordService
{
    public const int LENGTH = 16;

    /** Active app passwords one user may hold. */
    public const int MAX_ACTIVE = 50;

    /** `last_used_at` is written at most once per this many seconds per row. */
    public const int TOUCH_INTERVAL_SECONDS = 300;

    private const string ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

    private const int CLIENT_MAX = 120;

    /**
     * The only place an app password is hashed. Whitespace is stripped first, so
     * `abcd efgh ijkl mnop` and `abcdefghijklmnop` hash the same.
     */
    public static function hashNormalized(string $password): string
    {
        return hash('sha256', self::normalize($password));
    }

    /**
     * True when the string could be an app password after whitespace is stripped.
     */
    public static function isShaped(string $password): bool
    {
        return preg_match('/^[a-z]{'.self::LENGTH.'}$/', self::normalize($password)) === 1;
    }

    private static function normalize(string $password): string
    {
        return (string) preg_replace('/\s+/', '', $password);
    }

    /**
     * @return list<array{id: int, name: string, createdAt: string, lastUsedAt: string|null, lastUsedClient: string|null}>
     */
    public function listFor(string $username): array
    {
        $rows = AppPassword::query()
            ->where('username', $this->user($username))
            ->whereNull('revoked_at')
            ->orderByDesc('id')
            ->get();

        return array_values(array_map(fn (AppPassword $row): array => $this->summary($row), $rows->all()));
    }

    /**
     * @return array{appPassword: array{id: int, name: string, createdAt: string, lastUsedAt: string|null, lastUsedClient: string|null}, password: string}
     */
    public function create(string $username, string $name): array
    {
        $username = $this->user($username);
        $active = AppPassword::query()->where('username', $username)->whereNull('revoked_at')->count();
        if ($active >= self::MAX_ACTIVE) {
            throw new ApiHttpException(422, 'Revoke an app password before you create another one.', 'app_password_limit');
        }

        $plain = $this->generate();
        $row = AppPassword::query()->create([
            'username' => $username,
            'name' => $name,
            'token_hash' => self::hashNormalized($plain),
            'created_at' => Carbon::now(),
        ]);

        return ['appPassword' => $this->summary($row), 'password' => $plain];
    }

    public function revoke(string $username, int $id): void
    {
        $updated = AppPassword::query()
            ->whereKey($id)
            ->where('username', $this->user($username))
            ->whereNull('revoked_at')
            ->update(['revoked_at' => Carbon::now()]);
        if ($updated === 0) {
            throw new ApiHttpException(404, 'App password not found.', 'not_found');
        }
    }

    public function revokeAll(string $username): void
    {
        AppPassword::query()
            ->where('username', $this->user($username))
            ->whereNull('revoked_at')
            ->update(['revoked_at' => Carbon::now()]);
    }

    /**
     * Removes every row of a deleted account, so a later account with the same
     * username starts without them.
     */
    public function forgetUser(string $username): void
    {
        AppPassword::query()->where('username', $this->user($username))->delete();
    }

    /**
     * True for an active app password of this user. Records the client at most
     * once per {@see TOUCH_INTERVAL_SECONDS}.
     */
    public function matches(string $username, string $password, ?string $client): bool
    {
        if (! self::isShaped($password)) {
            return false;
        }

        $hash = self::hashNormalized($password);
        $row = AppPassword::query()
            ->where('username', $this->user($username))
            ->where('token_hash', $hash)
            ->whereNull('revoked_at')
            ->first(['id', 'token_hash']);
        if ($row === null || ! hash_equals((string) $row->token_hash, $hash)) {
            return false;
        }

        $now = Carbon::now();
        AppPassword::query()
            ->whereKey($row->id)
            ->where(static function ($query) use ($now): void {
                $query->whereNull('last_used_at')
                    ->orWhere('last_used_at', '<=', $now->copy()->subSeconds(self::TOUCH_INTERVAL_SECONDS));
            })
            ->update(['last_used_at' => $now, 'last_used_client' => $this->clientLabel($client)]);

        return true;
    }

    private function generate(): string
    {
        $max = strlen(self::ALPHABET) - 1;
        $plain = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $plain .= self::ALPHABET[random_int(0, $max)];
        }

        return $plain;
    }

    private function clientLabel(?string $client): ?string
    {
        $trimmed = trim((string) $client);

        return $trimmed === '' ? null : mb_substr($trimmed, 0, self::CLIENT_MAX);
    }

    private function user(string $username): string
    {
        return strtolower(trim($username));
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
