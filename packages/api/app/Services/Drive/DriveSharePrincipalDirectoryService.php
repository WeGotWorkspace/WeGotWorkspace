<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Dav\Server\AccountPrincipalFilter;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Settings\GroupDirectoryService;

final class DriveSharePrincipalDirectoryService
{
    public function __construct(
        private GroupDirectoryService $groupDirectory,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function search(string $query, int $limit = 20): array
    {
        $query = strtolower(trim($query));
        $limit = max(1, min($limit, 50));

        $results = [];

        if ($query !== '') {
            $like = '%'.$query.'%';
            $users = Principal::query()
                ->where('uri', 'like', 'principals/%')
                ->where('uri', 'not like', AdminConstants::GROUP_PREFIX.'%')
                ->where(function ($builder) use ($like): void {
                    $builder->where('uri', 'like', $like)
                        ->orWhereRaw('LOWER(displayname) LIKE ?', [$like]);
                })
                ->orderBy('uri')
                ->limit($limit)
                ->get(['uri', 'displayname']);

            foreach ($users as $user) {
                $uri = (string) $user->uri;
                if (! AccountPrincipalFilter::isAccountPrincipalUri($uri)) {
                    continue;
                }
                $username = substr($uri, strlen('principals/'));
                $displayName = trim((string) $user->displayname);
                $results[] = [
                    'principal' => $username,
                    'principalType' => 'user',
                    'displayName' => $displayName !== '' ? $displayName : $username,
                ];
            }
        }

        $groupSummaries = $this->groupDirectory->listGroupSummaries();
        $groupUris = array_column($groupSummaries, 'id');
        $membersByGroup = $this->groupDirectory->memberPrincipalUrisByGroupUris($groupUris);

        foreach ($groupSummaries as $group) {
            $uri = (string) $group['id'];
            $slug = (string) $group['name'];
            $displayName = (string) $group['displayName'];
            $principal = 'groups/'.$slug;

            if ($query !== ''
                && ! str_contains(strtolower($slug), $query)
                && ! str_contains(strtolower($displayName), $query)) {
                continue;
            }

            $results[] = [
                'principal' => $principal,
                'principalType' => 'group',
                'displayName' => $displayName,
                'memberCount' => count($membersByGroup[$uri] ?? []),
            ];
        }

        usort($results, static fn (array $a, array $b): int => strcmp((string) $a['principal'], (string) $b['principal']));

        return array_slice($results, 0, $limit);
    }
}
