<?php

declare(strict_types=1);

namespace App\Services\Settings;

use App\Models\GroupMember;

final class GroupMembershipResolver
{
    /**
     * @return list<string>
     */
    public function memberPrincipalUris(string $groupUri): array
    {
        $byGroup = $this->memberPrincipalUrisByGroupUris([$groupUri]);

        return $byGroup[$groupUri] ?? [];
    }

    /**
     * @param  list<string>  $groupUris
     * @return array<string, list<string>>
     */
    public function memberPrincipalUrisByGroupUris(array $groupUris): array
    {
        $groupUris = array_values(array_unique(array_filter(array_map(
            static fn (string $uri): string => trim($uri),
            $groupUris,
        ))));

        $out = [];
        foreach ($groupUris as $groupUri) {
            $out[$groupUri] = [];
        }

        if ($groupUris === []) {
            return $out;
        }

        $rows = GroupMember::query()
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->whereIn('g.uri', $groupUris)
            ->orderBy('g.uri')
            ->orderBy('m.uri')
            ->get(['g.uri as group_uri', 'm.uri as member_uri']);

        foreach ($rows as $row) {
            $groupUri = (string) $row->getAttribute('group_uri');
            $memberUri = (string) $row->getAttribute('member_uri');
            $out[$groupUri][] = $memberUri;
        }

        return $out;
    }
}
