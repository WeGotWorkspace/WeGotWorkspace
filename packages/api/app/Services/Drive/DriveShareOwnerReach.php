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
 *
 * Reach is decided per group (the group named in the path), not per folder inside it.
 *
 * Bound as a scoped singleton (WgwServiceProvider): group memberships are loaded at most once per
 * principal per request, however many shares a request resolves. The provider clears the cache at
 * the start of every request, so a membership change applies on the next request.
 */
final class DriveShareOwnerReach
{
    /** @var array<string, list<string>> */
    private array $groupSlugsByPrincipal = [];

    public function __construct(
        private DriveSharePathScope $scope,
        private DriveGroupResolver $groups,
    ) {}

    public function principalReachesPath(string $username, string $path): bool
    {
        $principal = trim($username);
        $segments = explode('/', ltrim($path, '/'));
        $name = (string) ($segments[1] ?? '');
        if ($principal === '' || $name === '') {
            return false;
        }
        if ($segments[0] === 'users') {
            return strcasecmp($name, $principal) === 0;
        }
        if ($segments[0] === 'groups') {
            return in_array($name, $this->groupSlugsOf($principal), true);
        }

        return false;
    }

    public function ownerReachesShare(DriveShare $share): bool
    {
        return $this->principalReachesPath(
            strtolower((string) $share->owner_username),
            $this->scope->normalize((string) $share->path),
        );
    }

    public function forgetGroupMemberships(): void
    {
        $this->groupSlugsByPrincipal = [];
    }

    /**
     * @return list<string>
     */
    private function groupSlugsOf(string $principal): array
    {
        return $this->groupSlugsByPrincipal[$principal] ??= $this->groups->allowedGroupSlugs($principal);
    }
}
