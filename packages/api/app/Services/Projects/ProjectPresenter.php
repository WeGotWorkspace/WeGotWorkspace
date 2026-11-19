<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\CalendarInstance;
use App\Models\JmapFileNode;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamRoles;
use Illuminate\Database\Eloquent\Collection;

/**
 * Reads the registry of Projects (#817) for responses and for ensure, in a fixed
 * number of queries for any number of Projects.
 *
 * A CalDAV item counts as present when the Team still owns an instance of it.
 */
final class ProjectPresenter
{
    public function __construct(private readonly TeamRoles $roles) {}

    /**
     * @param  Collection<int, Project>  $projects
     * @return list<array<string, mixed>>
     */
    public function present(string $viewer, Collection $projects): array
    {
        if ($projects->isEmpty()) {
            return [];
        }
        $resources = $this->resourcesOf($projects);
        $instances = $this->ownerInstances($projects, $resources);
        $folders = $this->liveFolders($resources);
        $adminSlugs = array_flip($this->roles->teamAdminSlugsOf($viewer));

        $out = [];
        foreach ($projects as $project) {
            $groupSlug = (string) $project->group_slug;
            $items = [];
            foreach (ProjectKind::cases() as $kind) {
                $items[$kind->responseKey()] = null;
            }
            $items['driveFolderPath'] = null;
            foreach ($resources[(string) $project->id] ?? [] as $resource) {
                $kind = ProjectKind::tryFrom((string) $resource->kind);
                if ($kind === ProjectKind::DriveFolder) {
                    $folder = $folders[(string) $resource->locator] ?? null;
                    if ($folder !== null) {
                        $items['driveFolderId'] = (string) $folder->node_id;
                        // An archived Project's folder sits in the server-owned archive tree: no path to open (#819).
                        $items['driveFolderPath'] = $project->archived_at === null ? ProjectFolder::virtualPath($folder) : null;
                    }

                    continue;
                }
                if ($kind === null) {
                    continue;
                }
                $instance = $instances[self::instanceKey($groupSlug, (int) $resource->locator)] ?? null;
                if ($instance !== null) {
                    $items[$kind->responseKey()] = $kind->apiId($groupSlug, (string) $instance->uri);
                }
            }

            $out[] = [
                'id' => (string) $project->id,
                'teamSlug' => $groupSlug,
                'slug' => (string) $project->slug,
                'name' => (string) $project->name,
                'color' => $project->color,
                'isDefault' => $project->default_for_group !== null,
                'archived' => $project->archived_at !== null,
                'archivedAt' => $project->archived_at?->toIso8601ZuluString(),
                'mayManage' => isset($adminSlugs[$groupSlug]),
                'resources' => $items,
            ];
        }

        return $out;
    }

    /** @return array<string, mixed> */
    public function presentOne(string $viewer, Project $project): array
    {
        return $this->present($viewer, new Collection([$project]))[0];
    }

    /**
     * The Projects among these that lack one of the four collections.
     *
     * @param  Collection<int, Project>  $projects
     * @return list<Project>
     */
    public function projectsWithMissingCollections(Collection $projects): array
    {
        $resources = $this->resourcesOf($projects);
        $instances = $this->ownerInstances($projects, $resources);

        $missing = [];
        foreach ($projects as $project) {
            if ($this->kindsMissing($project, $resources[(string) $project->id] ?? [], $instances) !== []) {
                $missing[] = $project;
            }
        }

        return $missing;
    }

    /** @return list<ProjectKind> */
    public function missingCollectionKinds(Project $project): array
    {
        $projects = new Collection([$project]);
        $resources = $this->resourcesOf($projects);

        return $this->kindsMissing($project, $resources[(string) $project->id] ?? [], $this->ownerInstances($projects, $resources));
    }

    /**
     * @param  list<ProjectResource>  $resources
     * @param  array<string, CalendarInstance>  $instances
     * @return list<ProjectKind>
     */
    private function kindsMissing(Project $project, array $resources, array $instances): array
    {
        $present = [];
        foreach ($resources as $resource) {
            if (isset($instances[self::instanceKey((string) $project->group_slug, (int) $resource->locator)])) {
                $present[(string) $resource->kind] = true;
            }
        }

        return array_values(array_filter(
            ProjectKind::collections(),
            static fn (ProjectKind $kind): bool => ! isset($present[$kind->value]),
        ));
    }

    /**
     * @param  Collection<int, Project>  $projects
     * @return array<string, list<ProjectResource>> keyed by Project id
     */
    private function resourcesOf(Collection $projects): array
    {
        $byProject = [];
        foreach (ProjectResource::query()
            ->whereIn('project_id', $projects->map(static fn (Project $project): string => (string) $project->id)->all())
            ->get() as $resource) {
            $byProject[(string) $resource->project_id][] = $resource;
        }

        return $byProject;
    }

    /**
     * The Team-owned instances of the registered CalDAV items.
     *
     * @param  Collection<int, Project>  $projects
     * @param  array<string, list<ProjectResource>>  $resources
     * @return array<string, CalendarInstance> keyed by {@see instanceKey()}
     */
    private function ownerInstances(Collection $projects, array $resources): array
    {
        $calendarIds = [];
        foreach ($resources as $list) {
            foreach ($list as $resource) {
                if ((string) $resource->kind !== ProjectKind::DriveFolder->value) {
                    $calendarIds[(int) $resource->locator] = true;
                }
            }
        }
        if ($calendarIds === []) {
            return [];
        }
        $groupUris = $projects
            ->map(static fn (Project $project): string => AdminConstants::GROUP_PREFIX.$project->group_slug)
            ->unique()
            ->values()
            ->all();

        $byKey = [];
        foreach (CalendarInstance::query()
            ->whereIn('calendarid', array_keys($calendarIds))
            ->whereIn('principaluri', $groupUris)
            ->get(['calendarid', 'principaluri', 'uri']) as $instance) {
            $slug = substr((string) $instance->principaluri, strlen(AdminConstants::GROUP_PREFIX));
            $byKey[self::instanceKey($slug, (int) $instance->calendarid)] = $instance;
        }

        return $byKey;
    }

    /**
     * The live Project folders among the registered items, by node id.
     *
     * @param  array<string, list<ProjectResource>>  $resources
     * @return array<string, JmapFileNode>
     */
    private function liveFolders(array $resources): array
    {
        $nodeIds = [];
        foreach ($resources as $list) {
            foreach ($list as $resource) {
                if ((string) $resource->kind === ProjectKind::DriveFolder->value) {
                    $nodeIds[] = (string) $resource->locator;
                }
            }
        }
        if ($nodeIds === []) {
            return [];
        }

        return JmapFileNode::query()
            ->whereIn('node_id', $nodeIds)
            ->whereNull('deleted_at')
            ->get(['node_id', 'storage_key'])
            ->keyBy(static fn (JmapFileNode $node): string => (string) $node->node_id)
            ->all();
    }

    private static function instanceKey(string $groupSlug, int $calendarId): string
    {
        return $groupSlug.'|'.$calendarId;
    }
}
