<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Dav\Server\AccountPrincipalFilter;
use App\Models\Principal;
use App\Services\Settings\GroupDirectoryService;
use App\Services\Teams\TeamColleagues;

/**
 * The share picker: people who share a Team with the viewer and the viewer's own
 * Teams. Admins too, because a share from an admin reaches only their own Teams
 * ({@see TeamColleagues}, Admin rule). Anyone else answers like an unknown name.
 */
final class DriveSharePrincipalDirectoryService
{
    public function __construct(
        private GroupDirectoryService $groupDirectory,
        private TeamColleagues $colleagues,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function search(string $viewer, string $query, int $limit = 20): array
    {
        $query = strtolower(trim($query));
        $limit = max(1, min($limit, 50));

        $results = $query !== '' ? $this->matchingTeamMates($viewer, $query) : [];

        $ownTeams = array_values(array_filter(
            $this->groupDirectory->listGroupSummaries(),
            fn (array $group): bool => $this->colleagues->isOwnTeam($viewer, (string) $group['name']),
        ));
        $membersByGroup = $this->groupDirectory->memberPrincipalUrisByGroupUris(array_column($ownTeams, 'id'));

        foreach ($ownTeams as $group) {
            $slug = (string) $group['name'];
            $displayName = (string) $group['displayName'];

            if ($query !== ''
                && ! str_contains(strtolower($slug), $query)
                && ! str_contains(strtolower($displayName), $query)) {
                continue;
            }

            $results[] = [
                'principal' => 'groups/'.$slug,
                'principalType' => 'group',
                'displayName' => $displayName,
                'memberCount' => count($membersByGroup[(string) $group['id']] ?? []),
            ];
        }

        usort($results, static fn (array $a, array $b): int => strcmp((string) $a['principal'], (string) $b['principal']));

        return array_slice($results, 0, $limit);
    }

    /**
     * Team mates (real membership, the viewer included) whose username or display
     * name contains the query. Matched in PHP, so `%` and `_` are plain characters.
     *
     * @return list<array<string, mixed>>
     */
    private function matchingTeamMates(string $viewer, string $query): array
    {
        $uris = array_map(
            static fn (string $username): string => 'principals/'.$username,
            $this->colleagues->colleagues($viewer)->usernames(),
        );

        $results = [];
        foreach (Principal::query()->whereIn('uri', $uris)->orderBy('uri')->get(['uri', 'displayname']) as $user) {
            $uri = (string) $user->uri;
            if (! AccountPrincipalFilter::isAccountPrincipalUri($uri)) {
                continue;
            }
            $username = substr($uri, strlen('principals/'));
            $displayName = trim((string) $user->displayname);
            if (! str_contains(strtolower($username), $query) && ! str_contains(strtolower($displayName), $query)) {
                continue;
            }
            $results[] = [
                'principal' => $username,
                'principalType' => 'user',
                'displayName' => $displayName !== '' ? $displayName : $username,
            ];
        }

        return $results;
    }
}
