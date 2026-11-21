<?php

declare(strict_types=1);

namespace App\Services\Teams;

use App\Dav\Server\AccountPrincipalFilter;
use App\Exceptions\ApiHttpException;
use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use App\Services\Settings\GroupDirectoryService;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Members of one Team, and the users a team admin may add to it (#2278).
 *
 * {@see candidates()} is the one place where the team-admin role shows someone a user
 * outside their Teams: name, username and email, nothing else. Every method checks
 * {@see TeamRoles::mayManageMembers()} itself, and answers a Team the caller may not
 * manage exactly like a Team that does not exist.
 */
final class TeamMemberDirectory
{
    public const CANDIDATE_LIMIT = 20;

    public const CANDIDATE_MIN_QUERY = 2;

    /** Type-ahead with debounce stays under this. */
    public const CANDIDATE_REQUESTS_PER_MINUTE = 60;

    private const CANDIDATE_LIMITER = 'wgw-team-candidates';

    public function __construct(
        private readonly TeamRoles $roles,
        private readonly GroupDirectoryService $groups,
    ) {}

    /**
     * @return list<array{username: string, displayName: string, email: string, isTeamAdmin: bool}>
     */
    public function members(string $viewer, string $groupSlug): array
    {
        $groupUri = $this->manageableTeamUri($viewer, $groupSlug);
        $admins = $this->roles->teamAdminsOf($groupSlug);

        $out = [];
        foreach ($this->accountPrincipals($this->groups->memberPrincipalUris($groupUri)) as $user) {
            $out[] = $user + ['isTeamAdmin' => in_array($user['username'], $admins, true)];
        }

        return $out;
    }

    public function setMembership(string $viewer, string $groupSlug, string $username, bool $member): void
    {
        $groupUri = $this->manageableTeamUri($viewer, $groupSlug);
        $username = $this->existingUsername($username);
        $this->groups->setMembership($groupUri, $username, $member);
    }

    public function setTeamAdmin(string $viewer, string $groupSlug, string $username, bool $teamAdmin): void
    {
        $groupUri = $this->manageableTeamUri($viewer, $groupSlug);
        $username = $this->existingUsername($username);
        if (! $teamAdmin) {
            // A Team never ends up without a team admin through a dismissal.
            $admins = $this->roles->teamAdminsOf($groupSlug);
            if ($admins === [$username]) {
                throw new ApiHttpException(409, 'A Team needs at least one team admin.', 'last_team_admin');
            }
            $this->roles->dismiss($groupSlug, $username);

            return;
        }
        if (! in_array('principals/'.$username, $this->groups->memberPrincipalUris($groupUri), true)) {
            throw new ApiHttpException(409, 'Only a member of the team can be its team admin.', 'not_a_member');
        }
        $this->roles->appoint($groupSlug, $username);
    }

    /**
     * Users whose name, username or email contains the query, members of the Team included
     * (flagged). Matched in PHP, so `%` and `_` are plain characters.
     *
     * @return list<array{username: string, displayName: string, email: string, isMember: bool}>
     */
    public function candidates(string $viewer, string $groupSlug, string $query): array
    {
        $groupUri = $this->manageableTeamUri($viewer, $groupSlug);
        $this->consumeCandidateBudget($viewer);

        $query = mb_strtolower(trim($query));
        if (mb_strlen($query) < self::CANDIDATE_MIN_QUERY) {
            throw new ApiHttpException(
                400,
                'q must be at least '.self::CANDIDATE_MIN_QUERY.' characters.',
                'invalidProperties',
                ['q'],
            );
        }

        $members = $this->groups->memberPrincipalUris($groupUri);

        $out = [];
        foreach ($this->accountPrincipals(null) as $user) {
            $haystack = mb_strtolower($user['username']."\n".$user['displayName']."\n".$user['email']);
            if (! str_contains($haystack, $query)) {
                continue;
            }
            $out[] = $user + ['isMember' => in_array('principals/'.$user['username'], $members, true)];
            if (count($out) === self::CANDIDATE_LIMIT) {
                break;
            }
        }

        return $out;
    }

    /**
     * The Team's principal uri when it exists and the viewer may manage its members. An
     * unknown Team and one the viewer may not manage give the same 404.
     */
    private function manageableTeamUri(string $viewer, string $groupSlug): string
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$groupSlug;
        if (! $this->roles->mayManageMembers($viewer, $groupSlug)
            || ! Principal::query()->where('uri', $groupUri)->exists()) {
            throw new ApiHttpException(404, 'Team not found.', 'not_found');
        }

        return $groupUri;
    }

    private function existingUsername(string $username): string
    {
        $username = TeamMembershipReader::normalise($username);
        $uri = 'principals/'.$username;
        if (! AccountPrincipalFilter::isAccountPrincipalUri($uri) || ! Principal::query()->where('uri', $uri)->exists()) {
            throw new ApiHttpException(404, 'User not found.', 'not_found');
        }

        return $username;
    }

    /**
     * Accounts (rows in `users`) with their principal's name and email, ordered by username.
     * Group principals and principals without an account are never returned.
     *
     * @param  list<string>|null  $uris  limit to these principal uris; null for every account
     * @return list<array{username: string, displayName: string, email: string}>
     */
    private function accountPrincipals(?array $uris): array
    {
        $accounts = User::query();
        if ($uris !== null) {
            $usernames = [];
            foreach ($uris as $uri) {
                if (preg_match('#^principals/([^/]+)$#', $uri, $matches) === 1 && $matches[1] !== 'groups') {
                    $usernames[] = $matches[1];
                }
            }
            if ($usernames === []) {
                return [];
            }
            $accounts->whereIn('username', $usernames);
        }
        $usernames = array_map(strval(...), $accounts->orderBy('username')->pluck('username')->all());
        if ($usernames === []) {
            return [];
        }

        $principals = Principal::query()
            ->whereIn('uri', array_map(static fn (string $username): string => 'principals/'.$username, $usernames))
            ->get(['uri', 'displayname', 'email'])
            ->keyBy('uri');

        $out = [];
        foreach ($usernames as $username) {
            $row = $principals->get('principals/'.$username);
            if ($row === null) {
                continue;
            }
            $displayName = trim((string) $row->displayname);
            $out[] = [
                'username' => $username,
                'displayName' => $displayName !== '' ? $displayName : $username,
                'email' => trim((string) $row->email),
            ];
        }

        return $out;
    }

    private function consumeCandidateBudget(string $viewer): void
    {
        $key = self::CANDIDATE_LIMITER.':user:'.TeamMembershipReader::normalise($viewer);
        if (RateLimiter::tooManyAttempts($key, self::CANDIDATE_REQUESTS_PER_MINUTE)) {
            throw new ApiHttpException(
                429,
                'Too many requests.',
                'rate_limited',
                [],
                ['Retry-After' => max(1, RateLimiter::availableIn($key))],
            );
        }
        RateLimiter::hit($key, 60);
    }
}
