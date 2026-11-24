<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\Principal;
use App\Services\Teams\TeamColleagues;

/**
 * TeamMember records: everyone the viewer may read, with a per-person
 * `version` (a hash of their name and settings stamp) and a list `state`
 * (a hash of every visible id and version). A rename, a switch change or an
 * include or detail change moves the version; joining or leaving, and a
 * change of the Teams a person shares with the viewer, move the state.
 * `teamSlugs` lists only Teams the viewer is in too, never a Team the viewer
 * cannot see.
 *
 * @phpstan-type TeamMember array{id: string, name: string, isSelf: bool, version: string, teamSlugs: list<string>}
 */
final class AvailabilityTeamMembers
{
    public function __construct(
        private readonly AvailabilityAudience $audience,
        private readonly AvailabilitySettings $settings,
        private readonly TeamColleagues $colleagues,
    ) {}

    /**
     * @return array{state: string, list: array<string, TeamMember>}
     */
    public function visibleTo(string $viewer): array
    {
        $list = [];
        $viewerTeams = $this->colleagues->teamSlugsOf($viewer);
        foreach ($this->audience->visibleTo($viewer) as $username) {
            $name = trim((string) (Principal::forUsername($username)->displayname ?? ''));
            $name = $name !== '' ? $name : $username;
            $list[$username] = [
                'id' => $username,
                'name' => $name,
                'isSelf' => $username === $viewer,
                'version' => substr(hash('sha256', $name."\n".($this->settings->settingsStamp($username) ?? '')), 0, 16),
                'teamSlugs' => array_values(array_intersect($viewerTeams, $this->colleagues->teamSlugsOf($username))),
            ];
        }

        $versions = array_map(static fn (array $member): string => $member['id'].':'.$member['version'].':'.implode(',', $member['teamSlugs']), array_values($list));

        return ['state' => substr(hash('sha256', implode("\n", $versions)), 0, 16), 'list' => $list];
    }
}
