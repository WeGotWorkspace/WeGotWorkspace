<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\ProjectResource;

/**
 * Which Project owns a collection (#817 B1, spec "Guards on Project collections"), and
 * whether that Project is archived (#819 B2).
 *
 * The collection ids of all Projects are read once per request (one query), so guards,
 * read filters and responses cost nothing per row. Request-scoped; {@see forget()} after
 * a Project write in the same request.
 */
final class ProjectRegistry
{
    /** @var array<int, string>|null calendars.id => project id */
    private ?array $byCalendarId = null;

    /** @var array<int, true> calendars.id of collections whose Project is archived */
    private array $archived = [];

    public function projectIdFor(int $calendarId): ?string
    {
        return $this->byCalendarId()[$calendarId] ?? null;
    }

    public function isProjectCollection(int $calendarId): bool
    {
        return $this->projectIdFor($calendarId) !== null;
    }

    /**
     * Whether the collection belongs to an archived Project: hidden for everyone, sharees
     * included, on every read path.
     */
    public function isArchived(int $calendarId): bool
    {
        $this->byCalendarId();

        return isset($this->archived[$calendarId]);
    }

    public function forget(): void
    {
        $this->byCalendarId = null;
        $this->archived = [];
    }

    /** @return array<int, string> */
    private function byCalendarId(): array
    {
        if ($this->byCalendarId === null) {
            $this->byCalendarId = [];
            foreach (ProjectResource::query()
                ->join('projects', 'projects.id', '=', 'project_resources.project_id')
                ->whereIn('project_resources.kind', array_map(static fn (ProjectKind $kind): string => $kind->value, ProjectKind::collections()))
                ->get(['project_resources.project_id', 'project_resources.locator', 'projects.archived_at']) as $resource) {
                $this->byCalendarId[(int) $resource->locator] = (string) $resource->project_id;
                if ($resource->getAttribute('archived_at') !== null) {
                    $this->archived[(int) $resource->locator] = true;
                }
            }
        }

        return $this->byCalendarId;
    }
}
