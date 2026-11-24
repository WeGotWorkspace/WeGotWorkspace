<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\ProjectMarker;
use Illuminate\Support\Facades\DB;

/**
 * One change marker per Team for its Projects (#817): the `Project` push state.
 * Every Project write bumps the marker of its Team. A missing row reads as 0.
 */
final class ProjectMarkers
{
    public function bump(string $groupSlug): void
    {
        ProjectMarker::query()->upsert(
            [['group_slug' => $groupSlug, 'marker' => 1]],
            ['group_slug'],
            ['marker' => DB::raw('marker + 1')],
        );
    }

    /**
     * @param  list<string>  $groupSlugs
     * @return array<string, int> slug => marker, for every slug asked
     */
    public function markersFor(array $groupSlugs): array
    {
        $markers = array_fill_keys($groupSlugs, 0);
        if ($groupSlugs === []) {
            return $markers;
        }
        foreach (ProjectMarker::query()->whereIn('group_slug', $groupSlugs)->get(['group_slug', 'marker']) as $row) {
            $markers[(string) $row->group_slug] = (int) $row->marker;
        }

        return $markers;
    }

    public function forget(string $groupSlug): void
    {
        ProjectMarker::query()->where('group_slug', $groupSlug)->delete();
    }
}
