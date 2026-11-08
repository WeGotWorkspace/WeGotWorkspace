<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\CalendarAvailabilityOwner;
use App\Models\User;
use App\Services\Teams\TeamColleagues;

/**
 * Who may see whose availability. A viewer reads a person only when the
 * person has the switch on, is not disabled, and shares at least one Team
 * with the viewer through real membership: the admin role gives nothing
 * extra. The viewer may always read themselves under the same switch and
 * disabled checks. Checked on every request; nothing is ever revoked.
 */
final class AvailabilityAudience
{
    public function __construct(
        private readonly TeamColleagues $colleagues,
    ) {}

    /**
     * Everyone the viewer may read, the viewer included while their own
     * switch is on, sorted by username.
     *
     * @return list<string>
     */
    public function visibleTo(string $viewer): array
    {
        $candidates = $this->teamMates($viewer);
        $candidates[] = $viewer;

        return $this->sharing(array_values(array_unique($candidates)));
    }

    public function mayRead(string $viewer, string $owner): bool
    {
        if ($owner !== $viewer && ! $this->sharesTeam($viewer, $owner)) {
            return false;
        }

        return $this->sharing([$owner]) === [$owner];
    }

    /** Real Team membership, admins included: the free/busy row of {@see TeamColleagues}. */
    public function sharesTeam(string $viewer, string $owner): bool
    {
        return $this->colleagues->sharesTeamIgnoringAdminRole($viewer, $owner);
    }

    /**
     * Of $usernames, the ones with the switch on and an enabled account.
     *
     * @param  list<string>  $usernames
     * @return list<string>
     */
    private function sharing(array $usernames): array
    {
        if ($usernames === []) {
            return [];
        }

        $switchedOn = CalendarAvailabilityOwner::query()
            ->whereIn('principal_uri', array_map(AvailabilitySettings::principalUri(...), $usernames))
            ->where('enabled', true)
            ->pluck('principal_uri')
            ->map(static fn (mixed $uri): string => substr((string) $uri, strlen('principals/')))
            ->all();
        $enabled = User::query()
            ->whereIn('username', $switchedOn)
            ->where('enabled', true)
            ->pluck('username')
            ->map(static fn (mixed $username): string => (string) $username)
            ->all();
        sort($enabled);

        return $enabled;
    }

    /**
     * Users who share a Team with the viewer through real membership, the
     * viewer left out. An admin's set is still only their real Team mates.
     *
     * @return list<string>
     */
    private function teamMates(string $viewer): array
    {
        return array_values(array_filter(
            $this->colleagues->colleagues($viewer)->usernames(),
            static fn (string $username): bool => $username !== $viewer,
        ));
    }
}
