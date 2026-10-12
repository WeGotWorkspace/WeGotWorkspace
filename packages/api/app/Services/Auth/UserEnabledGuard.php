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
        return $this->enabledSession($username) !== null;
    }

    /**
     * Enabled flag and UI-cookie epoch from one users query.
     *
     * @return array{enabled: true, epoch: int}|null
     */
    public function enabledSession(string $username): ?array
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return null;
        }
        if (str_starts_with($username, 'share:')) {
            return ['enabled' => true, 'epoch' => 0];
        }

        $user = User::query()->where('username', $username)->first();
        if ($user === null || ! $user->isEnabled()) {
            return null;
        }

        return ['enabled' => true, 'epoch' => (int) $user->ui_session_epoch];
    }
}
