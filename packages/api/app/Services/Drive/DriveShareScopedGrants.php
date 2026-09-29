<?php

declare(strict_types=1);

namespace App\Services\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Illuminate\Support\Collection;

/**
 * Loads share rows and their grants for ACL and principal queries.
 */
final class DriveShareScopedGrants
{
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
            ->get();

        return ['sharesById' => $sharesById, 'grants' => $grants];
    }
}
