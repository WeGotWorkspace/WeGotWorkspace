<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Exceptions\ApiHttpException;
use App\Models\Principal;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Teams\TeamColleagues;
use App\Services\Teams\TeamRoles;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Projects of a Team (#817, spec 810-projects-on-teams): read, create, rename and recolor.
 *
 * Access is Team membership and nothing else. A caller who is not a member of the
 * Project's Team gets the same 404 as for an unknown id, an organization admin
 * included. Writes need {@see TeamRoles::mayManageProjects()}.
 *
 * Ensure: every read repairs the live Projects it returns. A collection that is gone
 * is created again and its registry row points at the new one. Ensure never creates
 * a Project.
 */
final class ProjectService
{
    public const NAME_MAX_LENGTH = 100;

    private const CREATE_ATTEMPTS = 5;

    public function __construct(
        private readonly TeamColleagues $colleagues,
        private readonly TeamRoles $roles,
        private readonly ProjectCollections $collections,
        private readonly ProjectMarkers $markers,
        private readonly ProjectPresenter $presenter,
        private readonly ProjectSlugs $slugs,
        private readonly DefaultProjectProvisioner $defaults,
        private readonly ProjectFolder $folders,
        private readonly ProjectFolderEnsurer $folderEnsurer,
    ) {}

    /** @return list<array<string, mixed>> the Projects of the caller's Teams, the default Project of each Team first */
    public function list(string $viewer, bool $includeArchived): array
    {
        $teamSlugs = $this->colleagues->teamSlugsOf($viewer);
        if ($teamSlugs === []) {
            return [];
        }
        // A Team that predates Projects, or whose create was interrupted, gets its default Project here.
        $this->defaults->ensureForTeams($teamSlugs);

        $query = Project::query()
            ->whereIn('group_slug', $teamSlugs)
            ->orderBy('group_slug')
            ->orderByRaw('CASE WHEN default_for_group IS NULL THEN 1 ELSE 0 END')
            ->orderBy('name')
            ->orderBy('id');
        if (! $includeArchived) {
            $query->whereNull('archived_at');
        }
        $projects = $query->get();
        $this->ensure($projects);

        return $this->presenter->present($viewer, $projects);
    }

    /** @return array<string, mixed> */
    public function show(string $viewer, string $id): array
    {
        $project = $this->findVisible($viewer, $id);
        $this->ensure(new Collection([$project]));

        return $this->presenter->presentOne($viewer, $project);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $viewer, array $payload): array
    {
        $teamSlug = is_string($payload['teamSlug'] ?? null) ? trim($payload['teamSlug']) : '';
        if ($teamSlug === '') {
            throw new ApiHttpException(400, 'teamSlug is required.', 'invalidProperties', ['teamSlug']);
        }
        if (! $this->colleagues->isOwnTeam($viewer, $teamSlug)) {
            throw new ApiHttpException(404, 'Team not found.', 'not_found');
        }
        if (! $this->roles->mayManageProjects($viewer, $teamSlug)) {
            throw new ApiHttpException(403, 'Only a team admin can create a Project.', 'team_admin_only');
        }
        $name = $this->name($payload['name'] ?? null);
        $color = array_key_exists('color', $payload) ? $this->color($payload['color']) : null;

        $project = $this->createWithCollections($teamSlug, $name, $color);
        // After the commit: a directory cannot roll back. When this fails, ensure makes it on the next read.
        $this->folderEnsurer->ensure(new Collection([$project]));

        return $this->presenter->presentOne($viewer, $project);
    }

    /**
     * Rename or recolor. The name and color go to all four collections; slugs and uris stay.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function patch(string $viewer, string $id, array $payload): array
    {
        $project = $this->findVisible($viewer, $id);
        if (! $this->roles->mayManageProjects($viewer, (string) $project->group_slug)) {
            throw new ApiHttpException(403, 'Only a team admin can change a Project.', 'team_admin_only');
        }
        if (! array_key_exists('name', $payload) && ! array_key_exists('color', $payload)) {
            throw new ApiHttpException(400, 'Nothing to change: send name or color.', 'invalidProperties', ['name', 'color']);
        }
        $name = array_key_exists('name', $payload) ? $this->name($payload['name']) : null;
        $color = array_key_exists('color', $payload) ? $this->color($payload['color']) : null;

        $project = DB::connection('wgw')->transaction(function () use ($project, $name, $color): Project {
            $locked = Project::query()->whereKey($project->id)->lockForUpdate()->first();
            if ($locked === null) {
                throw new ApiHttpException(404, 'Project not found.', 'not_found');
            }
            if ($locked->archived_at !== null) {
                throw new ApiHttpException(409, 'An archived Project cannot be changed. Unarchive it first.', 'archived');
            }
            $locked->name = $name ?? (string) $locked->name;
            $locked->color = $color ?? $locked->color;
            $locked->save();
            $this->writeThrough($locked);
            $this->markers->bump((string) $locked->group_slug);

            return $locked;
        });
        $this->renameFolder($project);
        $this->ensure(new Collection([$project]));

        return $this->presenter->presentOne($viewer, $project);
    }

    /**
     * Repair the live Projects among these: each of the four collections exists and the
     * registry points at it. Idempotent; two overlapping reads repair once.
     *
     * @param  Collection<int, Project>  $projects
     */
    public function ensure(Collection $projects): void
    {
        $live = $projects->filter(static fn (Project $project): bool => $project->archived_at === null);
        if ($live->isEmpty()) {
            return;
        }

        foreach ($this->presenter->projectsWithMissingCollections($live) as $project) {
            DB::connection('wgw')->transaction(function () use ($project): void {
                $locked = Project::query()->whereKey($project->id)->lockForUpdate()->first();
                if ($locked === null || $locked->archived_at !== null) {
                    return;
                }
                $groupUri = AdminConstants::GROUP_PREFIX.$locked->group_slug;
                $missing = $this->presenter->missingCollectionKinds($locked);
                foreach ($missing as $kind) {
                    // The default Project's calendar, task list and notebook are the Team's provisioned ones.
                    $calendarId = $locked->default_for_group !== null && $kind !== ProjectKind::Channel
                        ? $this->defaults->provisionedCalendarId($locked, $kind)
                        : $this->collections->create($kind, $groupUri, (string) $locked->slug, (string) $locked->name, $locked->color);
                    ProjectResource::query()->updateOrCreate(
                        ['project_id' => $locked->id, 'kind' => $kind->value],
                        ['locator' => (string) $calendarId],
                    );
                }
                if ($missing !== []) {
                    $this->markers->bump((string) $locked->group_slug);
                }
            });
        }
        $this->folderEnsurer->ensure($live);
    }

    private function renameFolder(Project $project): void
    {
        $nodeId = ProjectResource::query()
            ->where('project_id', $project->id)
            ->where('kind', ProjectKind::DriveFolder->value)
            ->value('locator');
        if ($nodeId === null) {
            return;
        }
        // A failed rename fails the request: the new name is stored, so the same PATCH again runs the rename again.
        $this->folders->rename((string) $nodeId, (string) $project->group_slug, (string) $project->name);
    }

    /** A Project of one of the caller's Teams, or the 404 an unknown id gets. */
    public function findVisible(string $viewer, string $id): Project
    {
        $project = Project::query()->find(strtolower($id));
        if ($project === null || ! $this->colleagues->isOwnTeam($viewer, (string) $project->group_slug)) {
            throw new ApiHttpException(404, 'Project not found.', 'not_found');
        }

        return $project;
    }

    /**
     * Insert the Project and its four collections in one `wgw` transaction: a failure
     * after the first collection leaves no row and no collection. A lost race on the
     * slug index retries with the next free slug.
     */
    private function createWithCollections(string $teamSlug, string $name, ?string $color): Project
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$teamSlug;
        for ($attempt = 1; ; $attempt++) {
            try {
                return DB::connection('wgw')->transaction(function () use ($teamSlug, $groupUri, $name, $color): Project {
                    // Serialize creates per Team (the Team channel provisioner does the same).
                    $team = Principal::query()->where('uri', $groupUri)->lockForUpdate()->first(['id']);
                    if ($team === null) {
                        throw new ApiHttpException(404, 'Team not found.', 'not_found');
                    }
                    $slug = $this->slugs->free($teamSlug, $name);
                    $project = Project::query()->create([
                        'id' => strtolower((string) Str::ulid()),
                        'group_slug' => $teamSlug,
                        'slug' => $slug,
                        'name' => $name,
                        'color' => $color ?? CalendarColorPalette::forUri('prj-'.$slug),
                    ]);
                    foreach (ProjectKind::collections() as $kind) {
                        $calendarId = $this->collections->create($kind, $groupUri, $slug, $name, $project->color);
                        ProjectResource::query()->create([
                            'project_id' => $project->id,
                            'kind' => $kind->value,
                            'locator' => (string) $calendarId,
                        ]);
                    }
                    $this->markers->bump($teamSlug);

                    return $project;
                });
            } catch (UniqueConstraintViolationException $exception) {
                if ($attempt >= self::CREATE_ATTEMPTS) {
                    throw $exception;
                }
            }
        }
    }

    private function writeThrough(Project $project): void
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$project->group_slug;
        $kindsByCalendarId = [];
        foreach (ProjectResource::query()->where('project_id', $project->id)->get(['kind', 'locator']) as $resource) {
            $kind = ProjectKind::tryFrom((string) $resource->kind);
            if ($kind !== null && $kind !== ProjectKind::DriveFolder) {
                $kindsByCalendarId[(int) $resource->locator] = $kind;
            }
        }
        foreach ($this->collections->ownerInstances($groupUri, array_keys($kindsByCalendarId)) as $calendarId => $instance) {
            $this->collections->writeAppearance($kindsByCalendarId[$calendarId], $instance, (string) $project->name, $project->color);
        }
    }

    private function name(mixed $name): string
    {
        $name = is_string($name) ? trim($name) : '';
        if ($name === '') {
            throw new ApiHttpException(400, 'name is required.', 'invalidProperties', ['name']);
        }
        if (Str::length($name) > self::NAME_MAX_LENGTH) {
            throw new ApiHttpException(400, 'name is longer than '.self::NAME_MAX_LENGTH.' characters.', 'invalidProperties', ['name']);
        }

        return $name;
    }

    private function color(mixed $color): string
    {
        $normalized = is_string($color) ? CalendarColorPalette::normalize($color) : null;
        if ($normalized === null || preg_match('/^#[0-9a-f]{6}$/', $normalized) !== 1) {
            throw new ApiHttpException(400, 'color must be a hex color like #3b82f6.', 'invalidProperties', ['color']);
        }

        return $normalized;
    }
}
