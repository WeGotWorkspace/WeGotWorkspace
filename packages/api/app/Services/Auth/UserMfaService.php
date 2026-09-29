<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\UserMfa;
use Illuminate\Support\Carbon;

final class UserMfaService
{
    public function isEnabled(string $username): bool
    {
        return UserMfa::query()
            ->where('username', $this->normalize($username))
            ->whereNotNull('enabled_at')
            ->exists();
    }

    public function find(string $username): ?UserMfa
    {
        $row = UserMfa::query()->where('username', $this->normalize($username))->first();

        return $row instanceof UserMfa ? $row : null;
    }

    public function pendingSecret(string $username): ?string
    {
        $row = UserMfa::query()
            ->where('username', $this->normalize($username))
            ->whereNull('enabled_at')
            ->first();
        if (! $row instanceof UserMfa || ! is_string($row->totp_secret) || $row->totp_secret === '') {
            return null;
        }

        return $row->totp_secret;
    }

    public function storePending(string $username, string $secret): void
    {
        $username = $this->normalize($username);
        $row = UserMfa::query()->firstOrNew(['username' => $username]);
        if ($row->enabled_at !== null) {
            throw new ApiHttpException(409, 'Two-factor authentication is already on.', 'conflict');
        }
        if (is_string($row->totp_secret) && $row->totp_secret !== '') {
            return;
        }
        $row->totp_secret = $secret;
        $row->save();
    }

    public function enable(string $username, string $secret, int $step): void
    {
        $username = $this->normalize($username);
        $row = UserMfa::query()->firstOrNew(['username' => $username]);
        $row->totp_secret = $secret;
        $row->enabled_at = Carbon::now();
        $row->last_used_step = $step;
        $row->save();
    }

    public function disable(string $username): void
    {
        UserMfa::query()->where('username', $this->normalize($username))->delete();
    }

    private function normalize(string $username): string
    {
        return strtolower(trim($username));
    }
}
