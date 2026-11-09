<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\Availability\AvailabilityTeamMembers;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * TeamMember/get (urn:wgw:jmap:availability, #1909): who the caller may see
 * the availability of. Unknown people, people with the switch off, disabled
 * people and people who share no Team with the caller all land in
 * `notFound` alike. There is no TeamMember/changes; clients compare `state`.
 */
final class TeamMemberGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly AvailabilityTeamMembers $members) {}

    public function name(): string
    {
        return 'TeamMember/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::AVAILABILITY;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $visible = $this->members->visibleTo($username);
        $ids = $this->requestedIds($args);
        $notFound = [];
        if ($ids === null) {
            $list = array_values($visible['list']);
            $this->guardGetAllBound($list);
        } else {
            $list = [];
            foreach ($ids as $id) {
                if (isset($visible['list'][$id])) {
                    $list[] = $visible['list'][$id];
                } else {
                    $notFound[] = $id;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $visible['state'],
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}
