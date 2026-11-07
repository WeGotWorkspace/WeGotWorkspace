<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;

trait SeedsWgwIdentity
{
    protected function seedWgwUser(
        string $username,
        string $password = 'secret',
        ?string $email = null,
        ?string $displayName = null,
    ): User {
        $user = User::factory()->named($username)->withPassword($password)->create();
        Principal::factory()->forUsername($username, $displayName, $email)->create();

        return $user;
    }

    protected function seedWgwGroup(string $uri, string $displayName): Principal
    {
        return Principal::factory()->create([
            'uri' => $uri,
            'displayname' => $displayName,
            'email' => null,
        ]);
    }

    /** Admin is a role per user (#1925). */
    protected function grantAdminRole(Principal|string $user): void
    {
        $username = $user instanceof Principal ? substr((string) $user->uri, strlen('principals/')) : $user;
        User::query()->where('username', $username)->update(['is_admin' => true]);
    }

    protected function addPrincipalToGroup(Principal $group, Principal $member): GroupMember
    {
        return GroupMember::factory()->forGroupAndMember($group, $member)->create();
    }
}
