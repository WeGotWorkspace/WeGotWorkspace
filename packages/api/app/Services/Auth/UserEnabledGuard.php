<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;

/**
 * Shared enabled check so REST/JMAP bearer and Sabre Basic+cookie cannot drift.
 *
 * A missing {@code users} row is disabled. Explicit {@code share:} guest subjects
 * have no row and stay enabled.
 */
final class UserEnabledGuard
{
    public function isEnabled(string $username): bool
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return false;
        }
        if (str_starts_with($username, 'share:')) {
            return true;
        }

        $user = User::query()->where('username', $username)->first();

        return $user !== null && $user->isEnabled();
    }
}
