<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\CalendarAvailabilityOwner;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;

/**
 * Who may see whose availability. A viewer reads a person only when the
 * person has the switch on, is not disabled, and shares at least one Team
 * with the viewer through real membership: the admin role gives nothing
 * extra. The viewer may always read themselves under the same switch and
 * disabled checks. Checked on every request; nothing is ever revoked.
 */
final class AvailabilityAudience
{
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

    /** Real Team membership, admins included (#1917's `sharesTeamIgnoringAdminRole`). */
    public function sharesTeam(string $viewer, string $owner): bool
    {
        return in_array($owner, $this->teamMates($viewer), true);
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
     * Users who share a Team (`principals/groups/*`) with the viewer.
     *
     * @return list<string>
     */
    private function teamMates(string $viewer): array
    {
        $viewerPrincipal = Principal::forUsername($viewer);
        if ($viewerPrincipal === null) {
            return [];
        }

        $uris = GroupMember::query()
            ->from('groupmembers as mine')
            ->join('principals as team', 'team.id', '=', 'mine.principal_id')
            ->join('groupmembers as theirs', 'theirs.principal_id', '=', 'mine.principal_id')
            ->join('principals as mate', 'mate.id', '=', 'theirs.member_id')
            ->where('mine.member_id', $viewerPrincipal->id)
            ->where('team.uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->distinct()
            ->pluck('mate.uri');

        $mates = [];
        foreach ($uris as $uri) {
            if (preg_match('#^principals/([^/]+)$#', (string) $uri, $matches) === 1 && $matches[1] !== $viewer) {
                $mates[] = $matches[1];
            }
        }

        return $mates;
    }
}
