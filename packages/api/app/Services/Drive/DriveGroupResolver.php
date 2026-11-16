<?php

declare(strict_types=1);

namespace App\Services\Drive;

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
}
