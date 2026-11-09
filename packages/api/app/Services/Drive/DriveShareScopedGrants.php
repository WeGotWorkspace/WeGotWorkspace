<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Illuminate\Support\Collection;

/**
 * Loads share rows and their grants for the owner's access panel and principal queries.
 * Grants hidden by Epic #1915 (grantee outside the share owner's Teams) are left out; the
 * rows stay.
 */
final class DriveShareScopedGrants
{
    public function __construct(private readonly DriveShareGrantVisibility $visibility) {}

    /**
     * @param  list<string>  $shareIds
     * @return array{sharesById: Collection<string|int, DriveShare>, grants: Collection<int, DriveShareGrant>}
     */
    public function load(array $shareIds): array
    {
        /** @var Collection<int|string, DriveShare> $sharesById */
        $sharesById = DriveShare::query()
            ->whereIn('id', $shareIds)
            ->get()
            ->keyBy('id');

        /** @var Collection<int, DriveShareGrant> $grants */
        $grants = DriveShareGrant::query()
            ->with('share')
            ->whereIn('share_id', $shareIds)
            ->get()
            ->filter(fn (DriveShareGrant $grant): bool => $this->visibility->isVisible($grant))
            ->values();

        return ['sharesById' => $sharesById, 'grants' => $grants];
    }
}
