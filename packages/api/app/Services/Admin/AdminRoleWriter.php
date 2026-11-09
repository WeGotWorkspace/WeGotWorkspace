<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\User;
use App\Services\Auth\UserSessionRevoker;

/**
 * Grants and removes the admin role (#1925). A change signs the user out
 * everywhere, so no token keeps a role the user no longer has.
 */
final class AdminRoleWriter
{
    public function __construct(private UserSessionRevoker $sessions) {}

    public function set(string $username, bool $isAdmin, string $actingAdmin): void
    {
        $username = strtolower(trim($username));
        $user = User::query()->where('username', $username)->first();
        if ($user === null) {
            throw new \InvalidArgumentException('User not found.');
        }
        if ($user->is_admin === $isAdmin) {
            return;
        }
        if (! $isAdmin) {
            if ($username === strtolower(trim($actingAdmin))) {
                throw new \InvalidArgumentException('You cannot remove your own administrator access.');
            }
            $this->assertNotLastAdmin($username);
        }

        User::query()->where('username', $username)->update(['is_admin' => $isAdmin]);
        $this->sessions->revokeAll($username);
    }

    /**
     * Guards losing the role, by the role switch or by deleting the account.
     */
    public function assertNotLastAdmin(string $username): void
    {
        $isEnabledAdmin = User::query()->where('username', $username)->where('is_admin', true)->where('enabled', true)->exists();
        if ($isEnabledAdmin && User::query()->where('is_admin', true)->where('enabled', true)->count() <= 1) {
            throw new \InvalidArgumentException('The last administrator cannot be removed.');
        }
    }
}
