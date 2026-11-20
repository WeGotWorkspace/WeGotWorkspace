<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Exceptions\ApiHttpException;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamRoles;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Archive, unarchive and purge (#819 B2, spec "Archive, unarchive, purge").
 *
 * - Archive sets `archived_at`. The four collections disappear for everyone, sharees
 *   included ({@see ProjectRegistry::isArchived()} on every read path). The folder moves
 *   to the server-owned `.project-archive` tree with its node ids.
 * - Unarchive clears it and moves the folder back, with a suffix when the name is taken.
 * - Purge works on an archived Project only. It deletes the four collections, moves the
 *   folder to the purging member's Drive trash and deletes the rows. Each step is skipped
 *   when already done, so a purge that failed half-way completes on retry. The slug is
 *   free afterwards; while archived it stays reserved.
 *
 * The default Project cannot be archived or purged (409): it goes when the Team goes.
 * All three need the team-admin role for the Project's Team.
 */
final class ProjectLifecycle
{
    public function __construct(
        private readonly ProjectService $projects,
        private readonly ProjectPresenter $presenter,
        private readonly TeamRoles $roles,
        private readonly ProjectMarkers $markers,
        private readonly ProjectCollections $collections,
        private readonly ProjectFolder $folders,
        private readonly ProjectRegistry $registry,
    ) {}

    /** @return array<string, mixed> */
    public function archive(string $viewer, string $id): array
    {
        $project = $this->manageable($viewer, $id, 'archived');
        $project = $this->setArchived($project, true);
        $folder = $this->folderNodeId($project);
        if ($folder !== null) {
            try {
                $this->folders->archive($folder, (string) $project->group_slug, (string) $project->slug);
            } catch (\Throwable $exception) {
                // The Project is archived; the folder stays where it was and the next archive or unarchive moves it.
                Log::error('project_folder_archive_failed', ['project' => (string) $project->id, 'error' => $exception->getMessage()]);
            }
        }

        return $this->presenter->presentOne($viewer, $project);
    }

    /** @return array<string, mixed> */
    public function unarchive(string $viewer, string $id): array
    {
        $project = $this->manageable($viewer, $id, 'unarchived');
        $project = $this->setArchived($project, false);
        $folder = $this->folderNodeId($project);
        if ($folder !== null) {
            try {
                $this->folders->unarchive($folder, (string) $project->group_slug, (string) $project->name);
            } catch (\Throwable $exception) {
                Log::error('project_folder_unarchive_failed', ['project' => (string) $project->id, 'error' => $exception->getMessage()]);
            }
        }
        // Repair what went missing while it was archived.
        $this->projects->ensure(new Collection([$project]));

        return $this->presenter->presentOne($viewer, $project);
    }

    public function purge(string $viewer, string $id): void
    {
        $project = $this->manageable($viewer, $id, 'purged');
        if ($project->archived_at === null) {
            throw new ApiHttpException(409, 'Archive the Project before you purge it.', 'not_archived');
        }
        $groupUri = AdminConstants::GROUP_PREFIX.$project->group_slug;

        // One step per item, each committed on its own: a retry skips what is done.
        foreach ($this->resources($project) as $resource) {
            $kind = ProjectKind::tryFrom((string) $resource->kind);
            if ($kind === ProjectKind::DriveFolder) {
                $this->folders->trashFor((string) $resource->locator, $viewer);
            } elseif ($kind !== null) {
                $this->collections->delete($groupUri, (int) $resource->locator);
            }
            $resource->delete();
        }
        DB::connection('wgw')->transaction(function () use ($project): void {
            Project::query()->whereKey($project->id)->delete();
            $this->markers->bump((string) $project->group_slug);
        });
        $this->registry->forget();
    }

    /** A Project of the caller's Teams that the caller may manage and that is no default Project. */
    private function manageable(string $viewer, string $id, string $verb): Project
    {
        $project = $this->projects->findVisible($viewer, $id);
        if (! $this->roles->mayManageProjects($viewer, (string) $project->group_slug)) {
            throw new ApiHttpException(403, 'Only a team admin can change a Project.', 'team_admin_only');
        }
        if ($project->default_for_group !== null) {
            throw new ApiHttpException(409, 'The default Project cannot be '.$verb.'. It goes when the Team goes.', 'default_project');
        }

        return $project;
    }

    private function setArchived(Project $project, bool $archived): Project
    {
        $project = DB::connection('wgw')->transaction(function () use ($project, $archived): Project {
            $locked = Project::query()->whereKey($project->id)->lockForUpdate()->first();
            if ($locked === null) {
                throw new ApiHttpException(404, 'Project not found.', 'not_found');
            }
            if (($locked->archived_at !== null) !== $archived) {
                $locked->archived_at = $archived ? now() : null;
                $locked->save();
                $this->markers->bump((string) $locked->group_slug);
            }

            return $locked;
        });
        $this->registry->forget();

        return $project;
    }

    private function folderNodeId(Project $project): ?string
    {
        $nodeId = ProjectResource::query()
            ->where('project_id', $project->id)
            ->where('kind', ProjectKind::DriveFolder->value)
            ->value('locator');

        return $nodeId === null ? null : (string) $nodeId;
    }

    /** @return Collection<int, ProjectResource> the collections first, the folder last */
    private function resources(Project $project): Collection
    {
        return ProjectResource::query()
            ->where('project_id', $project->id)
            ->orderByRaw("CASE WHEN kind = 'drive_folder' THEN 1 ELSE 0 END")
            ->orderBy('id')
            ->get();
    }
}
