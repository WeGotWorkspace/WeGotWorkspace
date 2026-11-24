<?php

declare(strict_types=1);

namespace App\Services\Settings;

use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamMembershipReader;
use App\Services\Teams\TeamRoles;
use Illuminate\Support\Facades\DB;
use Sabre\DAVACL\PrincipalBackend\PDO as PrincipalBackend;

final class GroupDirectoryService
{
    public function __construct(
        private readonly GroupMembershipResolver $membership,
        private readonly TeamMembershipReader $teams,
        private readonly TeamRoles $roles,
    ) {}

    /**
     * @return list<array{id: string, name: string, displayName: string}>
     */
    public function listGroupSummaries(): array
    {
        $out = [];
        foreach ($this->listGroupCollections() as $group) {
            $uri = (string) $group['uri'];
            $out[] = [
                'id' => $uri,
                'name' => basename(str_replace('\\', '/', $uri)),
                'displayName' => (string) $group['title'],
            ];
        }

        return $out;
    }

    /**
     * For the organization admin: every Team with the usernames of its team admins.
     *
     * @return list<array{id: string, name: string, displayName: string, teamAdmins: list<string>}>
     */
    public function listGroupSummariesWithTeamAdmins(): array
    {
        $groups = $this->listGroupSummaries();
        $admins = $this->roles->teamAdminsByTeam(array_column($groups, 'name'));

        return array_map(
            static fn (array $group): array => $group + ['teamAdmins' => $admins[$group['name']] ?? []],
            $groups,
        );
    }

    /**
     * @return list<string>
     */
    public function memberPrincipalUris(string $groupUri): array
    {
        return $this->memberUris($groupUri);
    }

    /**
     * @param  list<string>  $groupUris
     * @return array<string, list<string>>
     */
    public function memberPrincipalUrisByGroupUris(array $groupUris): array
    {
        return $this->membership->memberPrincipalUrisByGroupUris($groupUris);
    }

    /**
     * @param  list<string>  $groupUris  principals/groups/{slug} or groups/{slug}
     * @return array<string, string> groupUri => displayName
     */
    public function displayNamesByGroupUris(array $groupUris): array
    {
        $normalized = [];
        foreach ($groupUris as $groupUri) {
            $groupUri = trim($groupUri);
            if ($groupUri === '') {
                continue;
            }
            if (str_starts_with($groupUri, 'groups/')) {
                $groupUri = AdminConstants::GROUP_PREFIX.substr($groupUri, strlen('groups/'));
            }
            $normalized[$groupUri] = true;
        }

        if ($normalized === []) {
            return [];
        }

        $rows = Principal::query()
            ->whereIn('uri', array_keys($normalized))
            ->get(['uri', 'displayname']);

        $out = [];
        foreach ($rows as $row) {
            $uri = (string) $row->uri;
            $title = trim((string) $row->displayname);
            if ($title === '') {
                $title = basename(str_replace('\\', '/', $uri));
            }
            $out[$uri] = $title;
        }

        return $out;
    }

    /**
     * @param  list<string>  $memberUsernames  Principal URIs or bare usernames
     */
    public function replaceMembers(string $groupUri, array $memberUsernames): void
    {
        $uris = [];
        foreach ($memberUsernames as $entry) {
            $uri = $this->toMemberPrincipalUri((string) $entry);
            if ($uri !== '') {
                $uris[$uri] = true;
            }
        }

        $this->writeMembers($groupUri, array_keys($uris));
    }

    public function setMembership(string $groupUri, string $username, bool $enabled): void
    {
        $principal = 'principals/'.$username;
        $members = $this->memberUris($groupUri);
        $isMember = in_array($principal, $members, true);

        if ($enabled && ! $isMember) {
            $members[] = $principal;
            $this->writeMembers($groupUri, $members);

            return;
        }

        if (! $enabled && $isMember) {
            $members = array_values(array_filter($members, static fn (string $m): bool => $m !== $principal));
            $this->writeMembers($groupUri, $members);
        }
    }

    /**
     * @return list<array{id: string, displayName: string, memberCount: int, isTeamAdmin: bool}>
     */
    public function groupsForUser(string $username): array
    {
        $adminOf = $this->roles->teamAdminSlugsOf($username);
        $groups = [];
        foreach ($this->teams->teamsOf($username) as $team) {
            $groups[] = [
                'id' => $team['uri'],
                'displayName' => $team['displayName'] !== '' ? $team['displayName'] : basename($team['uri']),
                'memberCount' => $team['memberCount'],
                'isTeamAdmin' => in_array($team['slug'], $adminOf, true),
            ];
        }

        return $groups;
    }

    /**
     * @return list<array{uri: string, title: string}>
     */
    private function listGroupCollections(): array
    {
        $prefix = AdminConstants::GROUP_PREFIX;
        $rows = Principal::query()
            ->where('uri', 'like', $prefix.'%')
            ->orderBy('uri')
            ->get(['uri', 'displayname']);

        $out = [];
        foreach ($rows as $row) {
            $uri = (string) $row->uri;
            $title = trim((string) $row->displayname);
            if ($title === '') {
                $title = basename(str_replace('\\', '/', $uri));
            }
            $out[] = ['uri' => $uri, 'title' => $title];
        }

        return $out;
    }

    /**
     * @return list<string>
     */
    private function memberUris(string $groupUri): array
    {
        return $this->membership->memberPrincipalUris($groupUri);
    }

    /**
     * @param  list<string>  $members
     */
    private function writeMembers(string $groupUri, array $members): void
    {
        // One transaction: nobody stays team admin of a Team they were just removed from (#2278).
        DB::connection('wgw')->transaction(function () use ($groupUri, $members): void {
            $backend = new PrincipalBackend(DB::connection('wgw')->getPdo());
            $backend->setGroupMemberSet($groupUri, $members);
            $this->teams->forget();
            if (str_starts_with($groupUri, AdminConstants::GROUP_PREFIX)) {
                $this->roles->pruneToMembers(
                    substr($groupUri, strlen(AdminConstants::GROUP_PREFIX)),
                    array_map(static fn (string $uri): string => basename($uri), $this->memberUris($groupUri)),
                );
            }
        });
        $this->teams->forget();
    }

    private function toMemberPrincipalUri(string $entry): string
    {
        $entry = trim($entry);
        if ($entry === '') {
            return '';
        }
        if (str_starts_with($entry, 'principals/')) {
            return $entry;
        }

        return 'principals/'.strtolower($entry);
    }
}
