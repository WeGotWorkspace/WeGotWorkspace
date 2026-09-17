<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;

/**
 * Shared enabled check so REST/JMAP bearer and Sabre Basic+cookie cannot drift.
 *
 * Missing {@code users} rows (share guests, ephemeral principals) are not disabled.
 */
final class UserEnabledGuard
{
    public function isEnabled(string $username): bool
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return false;
        }

        $user = User::query()->where('username', $username)->first();

        return $user === null || $user->isEnabled();
    }
}
