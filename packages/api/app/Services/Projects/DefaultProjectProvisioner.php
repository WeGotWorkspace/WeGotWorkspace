<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The default Project of a Team (#817, spec "Default Project").
 *
 * It bundles the Team's provisioned calendar (`{slug}`), task list (`tasks-{slug}`) and
 * notebook (`notes-{slug}`) with one new channel, and is named "{Team name} Project".
 * The existing collections keep their names and colors; the Project takes the Team
 * calendar's color. It has no Drive folder: its Drive view is the whole Team Drive.
 *
 * Made when a Team is created, by a one-time migration for existing Teams, and lazily on
 * `GET /projects` for a Team that still has none. Find-or-create: a Team never gets two.
 */
final class DefaultProjectProvisioner
{
    private const SUFFIX = ' Project';

    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $teamCollections,
        private readonly ProjectCollections $collections,
        private readonly ProjectMarkers $markers,
        private readonly ProjectSlugs $slugs,
    ) {}

    /**
     * Give each of these Teams its default Project when it has none. One query when all have one.
     *
     * @param  list<string>  $teamSlugs
     */
    public function ensureForTeams(array $teamSlugs): void
    {
        if ($teamSlugs === []) {
            return;
        }
        $have = array_flip(Project::query()
            ->whereIn('default_for_group', $teamSlugs)
            ->pluck('default_for_group')
            ->map(static fn (mixed $slug): string => (string) $slug)
            ->all());
        foreach ($teamSlugs as $teamSlug) {
            if (! isset($have[$teamSlug])) {
                $this->provision($teamSlug);
            }
        }
    }

    /** Every Team of the instance: the one-time backfill. Returns how many Teams were looked at. */
    public function ensureForAllTeams(): int
    {
        $slugs = Principal::query()
            ->where('uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->orderBy('id')
            ->pluck('uri')
            ->map(static fn (mixed $uri): string => substr((string) $uri, strlen(AdminConstants::GROUP_PREFIX)))
            ->filter(static fn (string $slug): bool => $slug !== '' && ! str_contains($slug, '/'))
            ->values()
            ->all();
        foreach (array_chunk($slugs, 200) as $chunk) {
            $this->ensureForTeams($chunk);
        }

        return count($slugs);
    }

    /**
     * The `calendars.id` of the Team's provisioned collection of this kind, created again
     * first when it is gone. Ensure uses it to relink a default Project.
     */
    public function provisionedCalendarId(Project $project, ProjectKind $kind): int
    {
        $teamSlug = (string) $project->group_slug;
        $groupUri = AdminConstants::GROUP_PREFIX.$teamSlug;
        $instance = $this->provisionedInstances($groupUri, $teamSlug)[$kind->value] ?? null;
        if ($instance === null) {
            $this->teamCollections->ensureForGroupPrincipal($groupUri, $this->teamName($groupUri, $teamSlug) ?? $teamSlug);
            $instance = $this->provisionedInstances($groupUri, $teamSlug)[$kind->value] ?? null;
        }
        if ($instance === null) {
            throw new \RuntimeException('The Team '.$teamSlug.' has no provisioned '.$kind->value.'.');
        }

        return (int) $instance->calendarid;
    }

    private function provision(string $teamSlug): void
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$teamSlug;
        $teamName = $this->teamName($groupUri, $teamSlug);
        if ($teamName === null) {
            return;
        }
        // A Team whose provisioned collection is missing gets it first (spec edge case).
        $this->teamCollections->ensureForGroupPrincipal($groupUri, $teamName);

        try {
            DB::connection('wgw')->transaction(function () use ($teamSlug, $groupUri, $teamName): void {
                // Serialize with Project creates and other first reads of this Team.
                Principal::query()->where('uri', $groupUri)->lockForUpdate()->get(['id']);
                if (Project::query()->where('default_for_group', $teamSlug)->exists()) {
                    return;
                }

                $instances = $this->provisionedInstances($groupUri, $teamSlug);
                $calendarColor = CalendarColorPalette::normalize($instances[ProjectKind::Calendar->value]->calendarcolor ?? null);
                $name = Str::limit($teamName, ProjectService::NAME_MAX_LENGTH - strlen(self::SUFFIX), '').self::SUFFIX;
                $slug = $this->slugs->free($teamSlug, $name);
                $project = Project::query()->create([
                    'id' => strtolower((string) Str::ulid()),
                    'group_slug' => $teamSlug,
                    'slug' => $slug,
                    'name' => $name,
                    'color' => $calendarColor !== null && preg_match('/^#[0-9a-f]{6}$/', $calendarColor) === 1
                        ? $calendarColor
                        : CalendarColorPalette::forUri($teamSlug),
                    'default_for_group' => $teamSlug,
                ]);

                foreach ($instances as $kind => $instance) {
                    ProjectResource::query()->create([
                        'project_id' => $project->id,
                        'kind' => $kind,
                        'locator' => (string) $instance->calendarid,
                    ]);
                }
                ProjectResource::query()->create([
                    'project_id' => $project->id,
                    'kind' => ProjectKind::Channel->value,
                    'locator' => (string) $this->collections->create(ProjectKind::Channel, $groupUri, $slug, $name, null),
                ]);
                $this->markers->bump($teamSlug);
            });
        } catch (UniqueConstraintViolationException) {
            // Lost a race on `default_for_group`: the winner made it.
        }
    }

    /** @return array<string, CalendarInstance> keyed by the ProjectKind value */
    private function provisionedInstances(string $groupUri, string $teamSlug): array
    {
        $uris = [
            CalendarCollectionUris::groupCalendarCalDavUri($teamSlug) => ProjectKind::Calendar,
            CalendarCollectionUris::groupTaskListCalDavUri($teamSlug) => ProjectKind::TaskList,
            CalendarCollectionUris::groupNotebookCalDavUri($teamSlug) => ProjectKind::Notebook,
        ];
        $byKind = [];
        foreach (CalendarInstance::query()
            ->where('principaluri', $groupUri)
            ->whereIn('uri', array_keys($uris))
            ->get(['calendarid', 'uri', 'calendarcolor']) as $instance) {
            $byKind[$uris[(string) $instance->uri]->value] = $instance;
        }

        return $byKind;
    }

    private function teamName(string $groupUri, string $teamSlug): ?string
    {
        $team = Principal::query()->where('uri', $groupUri)->first(['displayname']);
        if ($team === null) {
            return null;
        }

        return trim((string) ($team->displayname ?? '')) ?: $teamSlug;
    }
}
