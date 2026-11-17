<?php

declare(strict_types=1);

namespace App\Services\Teams;

use App\Models\GroupMember;
use App\Services\Admin\AdminConstants;

/**
 * Reads Team membership from `groupmembers`. A Team is a group principal under
 * `principals/groups/`. Every reader of "which Teams is X in" and "who shares a Team
 * with X" goes through here. {@see teamsOf()} is memoised for one request.
 */
final class TeamMembershipReader
{
    private const USER_URI_PATTERN = '#^principals/([^/]+)$#';

    /** @var array<string, list<array{uri: string, slug: string, displayName: string, memberCount: int}>> */
    private array $teams = [];

    /**
     * The user's Teams, ordered by uri, with how many members each has (a correlated
     * count in the same query).
     *
     * @return list<array{uri: string, slug: string, displayName: string, memberCount: int}>
     */
    public function teamsOf(string $username): array
    {
        $key = self::normalise($username);
        if (isset($this->teams[$key])) {
            return $this->teams[$key];
        }
        $rows = GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('m.uri', self::userUri($username))
            ->where('g.uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->distinct()
            ->orderBy('g.uri')
            ->select(['g.uri as team_uri', 'g.displayname as team_name'])
            ->selectSub(
                GroupMember::query()
                    ->from('groupmembers as gm')
                    ->selectRaw('count(*)')
                    ->whereColumn('gm.principal_id', 'g.id'),
                'member_count',
            )
            ->get();

        $teams = [];
        foreach ($rows as $row) {
            $uri = (string) $row->getAttribute('team_uri');
            $teams[] = [
                'uri' => $uri,
                'slug' => substr($uri, strlen(AdminConstants::GROUP_PREFIX)),
                'displayName' => trim((string) $row->getAttribute('team_name')),
                'memberCount' => (int) $row->getAttribute('member_count'),
            ];
        }

        return $this->teams[$key] = $teams;
    }

    public function forget(): void
    {
        $this->teams = [];
    }

    /**
     * Usernames of every user who shares at least one Team with the user, the user
     * included when they are in a Team. One self-join on `groupmembers`. Sorted.
     *
     * @return list<string>
     */
    public function teamMateUsernames(string $username): array
    {
        $uris = GroupMember::query()
            ->from('groupmembers as mine')
            ->join('principals as me', 'me.id', '=', 'mine.member_id')
            ->join('principals as team', 'team.id', '=', 'mine.principal_id')
            ->join('groupmembers as theirs', 'theirs.principal_id', '=', 'mine.principal_id')
            ->join('principals as mate', 'mate.id', '=', 'theirs.member_id')
            ->where('me.uri', self::userUri($username))
            ->where('team.uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->distinct()
            ->pluck('mate.uri');

        $usernames = [];
        foreach ($uris as $uri) {
            // Nested group principals and the groups container are not users.
            if (preg_match(self::USER_URI_PATTERN, (string) $uri, $matches) === 1 && $matches[1] !== 'groups') {
                $usernames[strtolower($matches[1])] = true;
            }
        }
        $usernames = array_keys($usernames);
        sort($usernames);

        return $usernames;
    }

    public static function normalise(string $username): string
    {
        return strtolower(trim($username));
    }

    private static function userUri(string $username): string
    {
        return 'principals/'.self::normalise($username);
    }
}
