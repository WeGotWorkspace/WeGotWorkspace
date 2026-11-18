<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamColleagues;

final class DriveGroupResolver
{
    public function __construct(
        private readonly TeamColleagues $colleagues,
    ) {}

    /**
     * Slugs of the user's own Teams, ordered.
     *
     * @return list<string>
     */
    public function allowedGroupSlugs(string $username): array
    {
        return $this->colleagues->teamSlugsOf($username);
    }

    /**
     * Principal uri => display name (the slug when it has none) of the user's Teams that have a
     * principal, in {@see allowedGroupSlugs()} order, with one query for all of them.
     *
     * @return array<string, string>
     */
    public function groupDisplayNames(string $username): array
    {
        $uris = array_map(
            static fn (string $slug): string => AdminConstants::GROUP_PREFIX.$slug,
            $this->allowedGroupSlugs($username),
        );
        if ($uris === []) {
            return [];
        }

        $groups = Principal::query()
            ->whereIn('uri', $uris)
            ->get(['uri', 'displayname'])
            ->keyBy(static fn (Principal $group): string => strtolower((string) $group->uri));
        $displayNames = [];
        foreach ($uris as $uri) {
            $group = $groups->get(strtolower($uri));
            if ($group !== null) {
                $displayNames[(string) $group->uri] = (string) ($group->displayname ?? substr($uri, strlen(AdminConstants::GROUP_PREFIX)));
            }
        }

        return $displayNames;
    }
}
