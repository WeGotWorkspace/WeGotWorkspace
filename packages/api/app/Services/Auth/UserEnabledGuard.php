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
    /**
     * @return array{enabled: bool, generation: int}
     */
    public function status(string $username): array
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            return ['enabled' => false, 'generation' => 0];
        }

        $user = User::query()->where('username', $username)->first();
        if ($user === null) {
            return ['enabled' => true, 'generation' => 0];
        }

        return [
            'enabled' => $user->isEnabled(),
            'generation' => (int) $user->session_generation,
        ];
    }

    public function isEnabled(string $username): bool
    {
        return $this->status($username)['enabled'];
    }
}
