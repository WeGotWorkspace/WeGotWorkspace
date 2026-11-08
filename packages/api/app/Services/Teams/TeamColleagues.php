<?php

declare(strict_types=1);

namespace App\Services\Teams;

use App\Exceptions\ApiHttpException;
use App\Services\Admin\AdminConstants;
use App\Services\Auth\AdminRoleResolver;
use Closure;

/**
 * The colleague rule (Epic #1915): a colleague is anyone who shares at least one Team with
 * the viewer. It is not transitive (A–B in T1 and B–C in T2 does not make A and C colleagues),
 * and every check is relative to the viewer. The viewer is always their own colleague.
 *
 * Admin rule. Admin is a role, not a Team. An admin finds and invites everyone; for DMs,
 * shares, presence and free/busy an admin follows real Team membership like any user,
 * because hiding is checked on the recipient's side.
 *
 * | Surface                                                         | Check                                                  |
 * |-----------------------------------------------------------------|--------------------------------------------------------|
 * | Scheduling invitees: attendee picker, mentions                  | `isColleague`                                          |
 * | DM rail and share dialogs (`sharesTeam` flag), Drive principals | `sharesTeamIgnoringAdminRole`                          |
 * | DM open, share writes, group sharee                             | `assertMayShareWith`, `isOwnTeam` (admins too)         |
 * | Hidden shares, owner share lists                                | `sharesTeamIgnoringAdminRole`                          |
 * | Presence rooms                                                  | own Teams only (admins too)                            |
 * | `principals/groups/`, `group-member-set`, `principals/{user}`   | `isColleague` / own Teams (admins: all)                |
 * | iTIP: JMAP → iMIP; DAV → same result as an external address     | `isColleague`                                          |
 * | VFREEBUSY, availability, #1614                                  | `sharesTeamIgnoringAdminRole`                          |
 *
 * No other variant exists. The set comes from one self-join on `groupmembers` and is memoised
 * for one request only (scoped binding, cleared in place when a request starts); nothing is
 * kept across requests or viewers.
 */
final class TeamColleagues
{
    /** @var array<string, list<string>> */
    private array $teamMates = [];

    /** @var array<string, list<string>> */
    private array $teamSlugs = [];

    /** @var array<string, bool> */
    private array $admins = [];

    /**
     * @param  Closure(): AdminRoleResolver  $adminRoles  a fresh resolver per lookup, so its own cache never outlives a request
     */
    public function __construct(
        private readonly TeamMembershipReader $membership,
        private readonly Closure $adminRoles,
    ) {}

    public function colleagues(string $viewer): ColleagueSet
    {
        $mates = $this->teamMatesOf($viewer);

        return $this->isAdmin($viewer)
            ? ColleagueSet::unrestricted($mates)
            : ColleagueSet::restricted($mates);
    }

    /** Find and invite: admins are colleagues of everyone. */
    public function isColleague(string $viewer, string $username): bool
    {
        return $this->colleagues($viewer)->contains($username);
    }

    /** Real Team membership, admins included: DMs, shares, hiding, presence, free/busy. */
    public function sharesTeamIgnoringAdminRole(string $viewer, string $username): bool
    {
        // Sharing a Team is symmetric: answer from whichever side is already loaded, so a
        // reader who checks many owners against themselves costs one membership query.
        $other = TeamMembershipReader::normalise($username);
        if (! isset($this->teamMates[TeamMembershipReader::normalise($viewer)]) && isset($this->teamMates[$other])) {
            return ColleagueSet::restricted($this->teamMates[$other])->contains($viewer);
        }

        return ColleagueSet::restricted($this->teamMatesOf($viewer))->contains($username);
    }

    /** Loads the user's Team mates now, so later checks against them reuse this one query. */
    public function loadTeamMatesOf(string $username): void
    {
        $this->teamMatesOf($username);
    }

    /** Real membership of `principals/groups/{groupSlug}`, admins included. */
    public function isOwnTeam(string $viewer, string $groupSlug): bool
    {
        return in_array(trim($groupSlug), $this->teamSlugsOf($viewer), true);
    }

    /**
     * Share-write gate for a principal uri: a user who shares a Team with the viewer, or one of
     * the viewer's own Teams. Admins included. Any other uri (unknown shapes, the groups
     * container) is refused.
     */
    public function mayShareWithPrincipalUri(string $viewer, string $principalUri): bool
    {
        $principalUri = trim($principalUri);
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return $this->isOwnTeam($viewer, substr($principalUri, strlen(AdminConstants::GROUP_PREFIX)));
        }
        if (preg_match('#^principals/([^/]+)$#', $principalUri, $matches) !== 1 || $matches[1] === 'groups') {
            return false;
        }

        return $this->sharesTeamIgnoringAdminRole($viewer, $matches[1]);
    }

    /**
     * Read side of the share gate (#1920): an existing grant from `$ownerPrincipalUri` to
     * `$granteePrincipalUri` counts only while the write gate would still allow it. A
     * Team-owned collection is never hidden. A user owner's grant to a user needs a shared
     * Team; to a Team, the owner must be in it. The answer is the same for the owner and for
     * the sharee, so a hidden grant is gone on both sides, admins included.
     */
    public function grantIsVisible(?string $ownerPrincipalUri, string $granteePrincipalUri): bool
    {
        if ($ownerPrincipalUri === null || preg_match('#^principals/([^/]+)$#', trim($ownerPrincipalUri), $matches) !== 1
            || $matches[1] === 'groups') {
            return true;
        }

        return $this->mayShareWithPrincipalUri($matches[1], $granteePrincipalUri);
    }

    /**
     * Refuses a sharee who shares no Team with the viewer exactly like an unknown principal,
     * so the response does not reveal that the account exists. Callers whose unknown case
     * throws a different exception pass that exception.
     */
    public function assertMayShareWith(string $viewer, string $username, ?ApiHttpException $asUnknown = null): void
    {
        if ($this->sharesTeamIgnoringAdminRole($viewer, $username)) {
            return;
        }

        throw $asUnknown ?? new ApiHttpException(
            400,
            'Unknown or invalid share principal.',
            'invalidProperties',
            ['shareWith/'.$username],
        );
    }

    /** Called when a request starts; see the binding in WgwServiceProvider. */
    public function forgetRequestState(): void
    {
        $this->teamMates = [];
        $this->teamSlugs = [];
        $this->admins = [];
    }

    /**
     * @return list<string>
     */
    private function teamMatesOf(string $viewer): array
    {
        $viewer = TeamMembershipReader::normalise($viewer);
        if (! isset($this->teamMates[$viewer])) {
            $mates = $this->membership->teamMateUsernames($viewer);
            if (! in_array($viewer, $mates, true)) {
                $mates[] = $viewer;
                sort($mates);
            }
            $this->teamMates[$viewer] = $mates;
        }

        return $this->teamMates[$viewer];
    }

    /**
     * @return list<string>
     */
    private function teamSlugsOf(string $viewer): array
    {
        $viewer = TeamMembershipReader::normalise($viewer);

        return $this->teamSlugs[$viewer] ??= array_column($this->membership->teamsOf($viewer), 'slug');
    }

    private function isAdmin(string $viewer): bool
    {
        $viewer = TeamMembershipReader::normalise($viewer);

        return $this->admins[$viewer] ??= ($this->adminRoles)()->isAdmin($viewer);
    }
}
