<?php

declare(strict_types=1);

namespace App\Services\Teams;

use App\Exceptions\ApiHttpException;
use App\Models\TeamAdmin;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Projects\ProjectMarkers;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Who runs a Team (#2278). The only reader and writer of `team_admins`.
 *
 * | Question                    | Team admin of that Team | Organization admin | Member |
 * |-----------------------------|-------------------------|--------------------|--------|
 * | `mayManageMembers`          | yes                     | yes, any Team      | no     |
 * | `mayManageProjects`         | yes                     | no                 | no     |
 * | `mayManageTeamCollections`  | yes                     | no                 | no     |
 *
 * A team admin is always a member: the role only counts while the user is in the Team, and
 * {@see pruneToMembers()} removes it when the membership goes.
 *
 * The role widens nothing in {@see TeamColleagues}. That class does not read this one, so
 * invitees, DMs, shares, presence, free/busy and availability answer the same for a team
 * admin as for any member. The one place a team admin sees users outside their Teams is
 * {@see TeamMemberDirectory::candidates()}.
 */
final class TeamRoles
{
    /** @var array<string, list<string>> */
    private array $adminSlugs = [];

    /**
     * @param  Closure(): AdminRoleResolver  $organizationAdmins  a fresh resolver per lookup, so its cache never outlives a request
     */
    public function __construct(
        private readonly TeamColleagues $colleagues,
        private readonly Closure $organizationAdmins,
        private readonly ProjectMarkers $projectMarkers,
    ) {}

    /** Team admin of `principals/groups/{groupSlug}` and still a member of it. */
    public function isTeamAdmin(string $viewer, string $groupSlug): bool
    {
        $groupSlug = trim($groupSlug);

        return in_array($groupSlug, $this->teamAdminSlugsOf($viewer), true);
    }

    /** Add and remove members, appoint and dismiss team admins: a team admin, or an organization admin for any Team. */
    public function mayManageMembers(string $viewer, string $groupSlug): bool
    {
        return $this->isTeamAdmin($viewer, $groupSlug)
            || ($this->organizationAdmins)()->isAdmin(TeamMembershipReader::normalise($viewer));
    }

    /** Create and manage the Team's Projects: team admins only. An organization admin has no bypass here. */
    public function mayManageProjects(string $viewer, string $groupSlug): bool
    {
        return $this->isTeamAdmin($viewer, $groupSlug);
    }

    /**
     * Create, delete and move away Team collections that are in no Project: team admins only.
     * An organization admin has no bypass here.
     */
    public function mayManageTeamCollections(string $viewer, string $groupSlug): bool
    {
        return $this->isTeamAdmin($viewer, $groupSlug);
    }

    public function assertMayManageTeamCollections(string $viewer, string $groupSlug, string $message): void
    {
        if (! $this->mayManageTeamCollections($viewer, $groupSlug)) {
            throw new ApiHttpException(403, $message, 'team_admin_only');
        }
    }

    /**
     * The Teams the viewer is team admin of, limited to Teams they are still a member of.
     *
     * @return list<string>
     */
    public function teamAdminSlugsOf(string $viewer): array
    {
        $viewer = TeamMembershipReader::normalise($viewer);
        if (! isset($this->adminSlugs[$viewer])) {
            $slugs = TeamAdmin::query()->where('username', $viewer)->orderBy('group_slug')->pluck('group_slug')->all();
            $this->adminSlugs[$viewer] = array_values(array_intersect(
                array_map(strval(...), $slugs),
                $this->colleagues->teamSlugsOf($viewer),
            ));
        }

        return $this->adminSlugs[$viewer];
    }

    /**
     * Usernames of the Team's admins, sorted. Rows for users who left are pruned on the
     * membership write, so this is not filtered again.
     *
     * @return list<string>
     */
    public function teamAdminsOf(string $groupSlug): array
    {
        return array_values(array_map(
            strval(...),
            TeamAdmin::query()->where('group_slug', trim($groupSlug))->orderBy('username')->pluck('username')->all(),
        ));
    }

    /**
     * @param  list<string>  $groupSlugs
     * @return array<string, list<string>> slug => usernames
     */
    public function teamAdminsByTeam(array $groupSlugs): array
    {
        $out = array_fill_keys($groupSlugs, []);
        if ($groupSlugs === []) {
            return $out;
        }
        foreach (TeamAdmin::query()->whereIn('group_slug', $groupSlugs)->orderBy('username')->get() as $row) {
            $out[$row->group_slug][] = $row->username;
        }

        return $out;
    }

    /** The caller has checked that `$username` is a member of the Team. */
    public function appoint(string $groupSlug, string $username): void
    {
        try {
            TeamAdmin::query()->firstOrCreate([
                'group_slug' => trim($groupSlug),
                'username' => TeamMembershipReader::normalise($username),
            ]);
        } catch (UniqueConstraintViolationException) {
            // Two appointments of the same person at once: the row is there.
        }
        $this->forget();
        // `mayManage` on the Team's Projects changed for this user: move the `Project` push state.
        $this->projectMarkers->bump(trim($groupSlug));
    }

    public function dismiss(string $groupSlug, string $username): void
    {
        TeamAdmin::query()
            ->where('group_slug', trim($groupSlug))
            ->where('username', TeamMembershipReader::normalise($username))
            ->delete();
        $this->forget();
        $this->projectMarkers->bump(trim($groupSlug));
    }

    /**
     * After a membership write: nobody stays team admin of a Team they are no longer in.
     *
     * @param  list<string>  $memberUsernames  the Team's members after the write
     */
    public function pruneToMembers(string $groupSlug, array $memberUsernames): void
    {
        $query = TeamAdmin::query()->where('group_slug', trim($groupSlug));
        if ($memberUsernames !== []) {
            $query->whereNotIn('username', array_map(TeamMembershipReader::normalise(...), $memberUsernames));
        }
        $query->delete();
        $this->forget();
    }

    public function removeTeam(string $groupSlug): void
    {
        TeamAdmin::query()->where('group_slug', trim($groupSlug))->delete();
        $this->forget();
    }

    public function removeUser(string $username): void
    {
        TeamAdmin::query()->where('username', TeamMembershipReader::normalise($username))->delete();
        $this->forget();
    }

    /** Called when a request starts; see the binding in WgwServiceProvider. */
    public function forget(): void
    {
        $this->adminSlugs = [];
    }
}
