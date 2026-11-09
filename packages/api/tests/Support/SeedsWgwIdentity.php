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

    protected function addPrincipalToGroup(Principal $group, Principal $member): GroupMember
    {
        return GroupMember::factory()->forGroupAndMember($group, $member)->create();
    }

    /**
     * Puts the users in one Team (created when missing), so the colleague rule of Epic #1915
     * lets them open DMs and share with each other.
     */
    protected function seedSharedTeam(string $slug, string ...$usernames): Principal
    {
        $uri = 'principals/groups/'.$slug;
        // Installs have the container principal; DAV resolves Team paths through it.
        if (! Principal::query()->where('uri', 'principals/groups')->exists()) {
            $this->seedWgwGroup('principals/groups', 'Groups');
        }
        $team = Principal::query()->where('uri', $uri)->first() ?? $this->seedWgwGroup($uri, ucfirst($slug));
        foreach ($usernames as $username) {
            $member = Principal::forUsername($username);
            if ($member === null) {
                throw new \LogicException('Seed the user before putting them in a Team: '.$username);
            }
            $isMember = GroupMember::query()
                ->where('principal_id', $team->id)
                ->where('member_id', $member->id)
                ->exists();
            if (! $isMember) {
                $this->addPrincipalToGroup($team, $member);
            }
        }

        return $team;
    }

    /**
     * Puts every user seeded so far in one Team, for tests whose users share with each other
     * but are not about Teams (Epic #1915 only lets colleagues share).
     */
    protected function seedSharedTeamForEveryone(string $slug = 'colleagues'): Principal
    {
        $usernames = Principal::query()
            ->where('uri', 'like', 'principals/%')
            ->where('uri', 'not like', 'principals/%/%')
            ->where('uri', '!=', 'principals/groups')
            ->pluck('uri')
            ->map(static fn (mixed $uri): string => substr((string) $uri, strlen('principals/')))
            ->all();

        return $this->seedSharedTeam($slug, ...$usernames);
    }
}
