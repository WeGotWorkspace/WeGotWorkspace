<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\Project;
use App\Models\ProjectResource;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Every live Project, the default one included, has a Project folder directly under
 * its Team Drive root. One that is gone (deleted outside the app, a create that failed
 * after its commit, a Team that predates default Project folders) is made again and the
 * registry points at the new node id. A name taken by an existing top-level folder gets
 * the ` (2)` suffix; nothing that is already there is moved.
 */
final class ProjectFolderEnsurer
{
    public function __construct(
        private readonly ProjectFolder $folders,
        private readonly ProjectMarkers $markers,
    ) {}

    /** @param  Collection<int, Project>  $projects */
    public function ensure(Collection $projects): void
    {
        $candidates = $projects->filter(static fn (Project $project): bool => $project->archived_at === null);
        if ($candidates->isEmpty()) {
            return;
        }
        $registered = ProjectResource::query()
            ->whereIn('project_id', $candidates->map(static fn (Project $project): string => (string) $project->id)->all())
            ->where('kind', ProjectKind::DriveFolder->value)
            ->pluck('locator', 'project_id');

        foreach ($candidates as $project) {
            $nodeId = $registered[(string) $project->id] ?? null;
            if ($nodeId !== null && $this->folders->live((string) $nodeId) !== null) {
                continue;
            }
            try {
                DB::connection('wgw')->transaction(function () use ($project): void {
                    $locked = Project::query()->whereKey($project->id)->lockForUpdate()->first();
                    if ($locked === null || $locked->archived_at !== null) {
                        return;
                    }
                    $current = ProjectResource::query()
                        ->where('project_id', $locked->id)
                        ->where('kind', ProjectKind::DriveFolder->value)
                        ->value('locator');
                    if ($current !== null && $this->folders->live((string) $current) !== null) {
                        return;
                    }
                    ProjectResource::query()->updateOrCreate(
                        ['project_id' => $locked->id, 'kind' => ProjectKind::DriveFolder->value],
                        ['locator' => $this->folders->create((string) $locked->group_slug, (string) $locked->name)],
                    );
                    $this->markers->bump((string) $locked->group_slug);
                });
            } catch (\Throwable $exception) {
                Log::error('project_folder_ensure_failed', ['project' => (string) $project->id, 'error' => $exception->getMessage()]);
            }
        }
    }
}
