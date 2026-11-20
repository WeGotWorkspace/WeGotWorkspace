<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\Project;
use App\Models\ProjectResource;

/**
 * The Projects of a Team when the Team goes (#819 B3, spec "Archive, unarchive, purge").
 *
 * Team delete removes every Project of the Team, live or archived: the rows here, inside
 * the delete's transaction; the collections through the Team's DAV teardown; the folders
 * with the Team's files. The counts feed the Admin confirmation.
 */
final class ProjectTeamTeardown
{
    public function __construct(private readonly ProjectMarkers $markers) {}

    /**
     * @param  list<string>  $teamSlugs
     * @return array<string, int> team slug => number of Projects, live or archived (0 when none)
     */
    public function countsByTeam(array $teamSlugs): array
    {
        $counts = array_fill_keys($teamSlugs, 0);
        if ($teamSlugs === []) {
            return $counts;
        }
        foreach (Project::query()
            ->whereIn('group_slug', $teamSlugs)
            ->selectRaw('group_slug, count(*) as aggregate')
            ->groupBy('group_slug')
            ->get() as $row) {
            $counts[(string) $row->group_slug] = (int) $row->getAttribute('aggregate');
        }

        return $counts;
    }

    /** Delete the Team's Project, registry and marker rows. Returns how many Projects went. */
    public function removeTeam(string $teamSlug): int
    {
        $ids = Project::query()->where('group_slug', $teamSlug)->pluck('id')->all();
        if ($ids !== []) {
            ProjectResource::query()->whereIn('project_id', $ids)->delete();
            Project::query()->whereIn('id', $ids)->delete();
        }
        $this->markers->forget($teamSlug);

        return count($ids);
    }
}
