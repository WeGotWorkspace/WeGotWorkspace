<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;

/**
 * Whether a principal reaches a share path: their own personal tree, or the tree of a group
 * they are a member of right now. Share creation requires it, and a share stays in force only
 * while its owner still has it. A share whose owner lost that reach (for example after removal
 * from the group) is dormant: share management treats it as not found and its grants, invites
 * and public links resolve to nothing. Nothing is deleted, so the share works again as soon as
 * the owner regains access.
 */
final class DriveShareOwnerReach
{
    public function __construct(
        private DriveSharePathScope $scope,
        private DriveGroupResolver $groups,
    ) {}

    /**
     * @param  list<string>|null  $groupSlugs  current group slugs of $username; loaded when null and needed
     */
    public function principalReachesPath(string $username, string $path, ?array $groupSlugs = null): bool
    {
        $segments = explode('/', ltrim($path, '/'));
        $name = (string) ($segments[1] ?? '');
        if ($segments[0] === 'users') {
            return $name !== '' && strcasecmp($name, $username) === 0;
        }
        if ($segments[0] === 'groups' && $name !== '') {
            return in_array($name, $groupSlugs ?? $this->groups->allowedGroupSlugs($username), true);
        }

        return false;
    }

    /**
     * Group memberships are loaded once per owner into $groupSlugsByOwner, so one resolution pass
     * over many shares costs at most one membership query per distinct owner of a group-path share.
     * Callers start a fresh memo per pass, so a membership change applies on the next request.
     *
     * @param  array<string, list<string>>  $groupSlugsByOwner
     */
    public function ownerReachesShare(DriveShare $share, array &$groupSlugsByOwner = []): bool
    {
        $owner = strtolower(trim((string) $share->owner_username));
        $path = $this->scope->normalize((string) $share->path);
        if ($owner === '') {
            return false;
        }
        if (! str_starts_with($path, '/groups/')) {
            return $this->principalReachesPath($owner, $path, []);
        }
        $groupSlugsByOwner[$owner] ??= $this->groups->allowedGroupSlugs($owner);

        return $this->principalReachesPath($owner, $path, $groupSlugsByOwner[$owner]);
    }
}
