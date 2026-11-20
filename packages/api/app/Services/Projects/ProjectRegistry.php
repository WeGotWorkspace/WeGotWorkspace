<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\ProjectResource;

/**
 * Which Project owns a collection (#817 B1, spec "Guards on Project collections").
 *
 * The collection ids of all Projects are read once per request (one query), so guards
 * and responses cost nothing per row. Request-scoped; {@see forget()} after a Project
 * write in the same request.
 */
final class ProjectRegistry
{
    /** @var array<int, string>|null calendars.id => project id */
    private ?array $byCalendarId = null;

    public function projectIdFor(int $calendarId): ?string
    {
        return $this->byCalendarId()[$calendarId] ?? null;
    }

    public function isProjectCollection(int $calendarId): bool
    {
        return $this->projectIdFor($calendarId) !== null;
    }

    public function forget(): void
    {
        $this->byCalendarId = null;
    }

    /** @return array<int, string> */
    private function byCalendarId(): array
    {
        if ($this->byCalendarId === null) {
            $this->byCalendarId = [];
            foreach (ProjectResource::query()
                ->whereIn('kind', array_map(static fn (ProjectKind $kind): string => $kind->value, ProjectKind::collections()))
                ->get(['project_id', 'locator']) as $resource) {
                $this->byCalendarId[(int) $resource->locator] = (string) $resource->project_id;
            }
        }

        return $this->byCalendarId;
    }
}
