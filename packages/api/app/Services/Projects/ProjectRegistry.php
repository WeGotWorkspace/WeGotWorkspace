<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\ProjectResource;

/**
 * Which Project owns a collection (#817 B1, spec "Guards on Project collections").
 *
 * One lookup per `calendars.id`, memoised for the request: listings prime it with one
 * query for every collection they map, so guards and responses cost no extra queries
 * per row. Request-scoped; {@see forget()} after a Project write in the same request.
 */
final class ProjectRegistry
{
    /** @var array<int, ?string> calendars.id => project id, null when in no Project */
    private array $byCalendarId = [];

    public function projectIdFor(int $calendarId): ?string
    {
        if (! array_key_exists($calendarId, $this->byCalendarId)) {
            $this->prime([$calendarId]);
        }

        return $this->byCalendarId[$calendarId] ?? null;
    }

    public function isProjectCollection(int $calendarId): bool
    {
        return $this->projectIdFor($calendarId) !== null;
    }

    /**
     * Load the owners of these collections in one query.
     *
     * @param  iterable<int|string>  $calendarIds
     */
    public function prime(iterable $calendarIds): void
    {
        $missing = [];
        foreach ($calendarIds as $calendarId) {
            $calendarId = (int) $calendarId;
            if ($calendarId > 0 && ! array_key_exists($calendarId, $this->byCalendarId)) {
                $missing[$calendarId] = true;
            }
        }
        if ($missing === []) {
            return;
        }
        foreach (array_keys($missing) as $calendarId) {
            $this->byCalendarId[$calendarId] = null;
        }
        foreach (array_chunk(array_map('strval', array_keys($missing)), 500) as $chunk) {
            foreach (ProjectResource::query()
                ->whereIn('kind', array_map(static fn (ProjectKind $kind): string => $kind->value, ProjectKind::collections()))
                ->whereIn('locator', $chunk)
                ->get(['project_id', 'locator']) as $resource) {
                $this->byCalendarId[(int) $resource->locator] = (string) $resource->project_id;
            }
        }
    }

    public function forget(): void
    {
        $this->byCalendarId = [];
    }
}
