<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;

/**
 * Shared REST cases for moving a collection between personal and group owners
 * (notebooks, task lists, chat channels). alice is team admin of crew and
 * alumni, bob a plain member of both.
 *
 * Adding a collection to a Team, deleting it, and moving it out need the
 * team-admin role (#2278), so only alice may do those. Members still rename it.
 */
trait GroupCollectionOwnerMoves
{
    protected const MOVE_GROUP = 'crew';

    protected const MOVE_OTHER_GROUP = 'alumni';

    protected const MOVE_ADMIN_ONLY = 'Only a team admin can move a team collection out of its team.';

    protected function seedGroupCollectionOwnerMoves(): void
    {
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');

        $alice = Principal::forUsername('alice');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($alice);
        $this->assertNotNull($bob);

        $admins = $this->seedWgwGroup(LegacyAdministratorsTeam::URI, 'Administrators');
        $this->addPrincipalToGroup($admins, $alice);
        $this->grantAdminRole($alice);
        foreach ([self::MOVE_GROUP => 'Crew', self::MOVE_OTHER_GROUP => 'Alumni'] as $slug => $name) {
            $group = $this->seedWgwGroup('principals/groups/'.$slug, $name);
            $this->addPrincipalToGroup($group, $alice);
            $this->addPrincipalToGroup($group, $bob);
            $this->appointTeamAdmin($slug, 'alice');
        }
    }

    /**
     * @param  array<string, mixed>  $extra  additional create fields
     */
    protected function assertOnlyAnAdminMovesAGroupCollectionOut(string $path, array $extra = []): void
    {
        $id = (string) $this->asMover('alice')->postJson($path, [
            'name' => 'Crew things', 'groupSlug' => self::MOVE_GROUP, ...$extra,
        ])->assertCreated()->json('id');

        foreach ([null, self::MOVE_OTHER_GROUP] as $target) {
            $this->asMover('bob')->patchJson($path.'/'.$id, ['groupSlug' => $target])
                ->assertForbidden()
                ->assertJsonPath('code', 'team_admin_only')
                ->assertJsonPath('error', self::MOVE_ADMIN_ONLY);
        }
        $this->asMover('bob')->patchJson($path.'/'.$id, ['name' => 'Crew renamed', 'groupSlug' => self::MOVE_GROUP])
            ->assertOk()
            ->assertJsonPath('name', 'Crew renamed');
        $this->asMover('bob')->getJson($path.'/'.$id)
            ->assertOk()
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::MOVE_GROUP);

        $this->asMover('alice')->patchJson($path.'/'.$id, ['groupSlug' => null])
            ->assertOk()
            ->assertJsonPath('scope', 'personal')
            ->assertJsonPath('groupSlug', null);
        $this->asMover('bob')->getJson($path.'/'.$id)->assertNotFound();
    }

    /**
     * @param  array<string, mixed>  $extra  additional create fields
     */
    protected function assertOnlyATeamAdminMovesAPersonalCollectionIntoAGroup(string $path, array $extra = []): void
    {
        $id = (string) $this->asMover('bob')->postJson($path, ['name' => 'Mine', ...$extra])
            ->assertCreated()
            ->json('id');
        $this->asMover('bob')->patchJson($path.'/'.$id, ['groupSlug' => self::MOVE_GROUP])
            ->assertForbidden()
            ->assertJsonPath('code', 'team_admin_only')
            ->assertJsonPath('error', 'Only a team admin can add a collection to a team.');
        $this->asMover('bob')->getJson($path.'/'.$id)->assertOk()->assertJsonPath('scope', 'personal');

        $id = (string) $this->asMover('alice')->postJson($path, ['name' => 'Hers', ...$extra])
            ->assertCreated()
            ->json('id');
        $this->asMover('alice')->patchJson($path.'/'.$id, ['groupSlug' => self::MOVE_GROUP])
            ->assertOk()
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::MOVE_GROUP);
    }

    private function asMover(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
