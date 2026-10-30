<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Services\Auth\AdminRoleResolver;

/**
 * Shared REST cases for moving a collection between personal and group owners
 * (notebooks, task lists, chat channels). alice is an instance admin, bob a
 * plain member; both belong to crew and alumni.
 *
 * Moving a group collection out of its group needs the same right as
 * deleting it, so only alice may do it. Members still rename it and move
 * their own personal collections into a group.
 */
trait GroupCollectionOwnerMoves
{
    protected const MOVE_GROUP = 'crew';

    protected const MOVE_OTHER_GROUP = 'alumni';

    protected const MOVE_ADMIN_ONLY = 'Only an instance admin can move a group collection out of its group.';

    protected function seedGroupCollectionOwnerMoves(): void
    {
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');

        $alice = Principal::forUsername('alice');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($alice);
        $this->assertNotNull($bob);

        $admins = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $this->addPrincipalToGroup($admins, $alice);
        foreach ([self::MOVE_GROUP => 'Crew', self::MOVE_OTHER_GROUP => 'Alumni'] as $slug => $name) {
            $group = $this->seedWgwGroup('principals/groups/'.$slug, $name);
            $this->addPrincipalToGroup($group, $alice);
            $this->addPrincipalToGroup($group, $bob);
        }
    }

    /**
     * @param  array<string, mixed>  $extra  additional create fields
     */
    protected function assertOnlyAnAdminMovesAGroupCollectionOut(string $path, array $extra = []): void
    {
        $id = (string) $this->asMover('bob')->postJson($path, [
            'name' => 'Crew things', 'groupSlug' => self::MOVE_GROUP, ...$extra,
        ])->assertCreated()->json('id');

        foreach ([null, self::MOVE_OTHER_GROUP] as $target) {
            $this->asMover('bob')->patchJson($path.'/'.$id, ['groupSlug' => $target])
                ->assertForbidden()
                ->assertJsonPath('code', 'group_delete_admin_only')
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
    protected function assertAMemberMovesAPersonalCollectionIntoAGroup(string $path, array $extra = []): void
    {
        $id = (string) $this->asMover('bob')->postJson($path, ['name' => 'Mine', ...$extra])
            ->assertCreated()
            ->json('id');

        $this->asMover('bob')->patchJson($path.'/'.$id, ['groupSlug' => self::MOVE_GROUP])
            ->assertOk()
            ->assertJsonPath('scope', 'group')
            ->assertJsonPath('groupSlug', self::MOVE_GROUP);
    }

    private function asMover(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
