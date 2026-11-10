<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;

/**
 * Admin is a role per user (`users.is_admin`, #1925), not membership of a Team.
 */
final class AdminRoleResolver
{
    /** @var array<string, bool> */
    private array $adminCache = [];

    public function isAdmin(string $username): bool
    {
        return $this->adminCache[$username] ??= User::query()
            ->where('username', $username)
            ->where('is_admin', true)
            ->exists();
    }

    /** Called when a request starts; see WgwServiceProvider. */
    public function forget(): void
    {
        $this->adminCache = [];
    }
}
