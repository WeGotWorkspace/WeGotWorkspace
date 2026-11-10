<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Services\Teams\TeamMembershipReader;

final class DriveGroupResolver
{
    public function __construct(
        private readonly TeamMembershipReader $membership,
    ) {}

    /**
     * Slugs of the user's own Teams, ordered.
     *
     * @return list<string>
     */
    public function allowedGroupSlugs(string $username): array
    {
        return array_column($this->membership->teamsOf($username), 'slug');
    }
}
