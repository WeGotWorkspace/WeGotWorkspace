<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\CalendarInstance;
use App\Models\GroupMember;
use App\Services\Admin\AdminConstants;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/** The usernames that own a task list: its ACL owners and, for a Team list, the Team's members. */
final class TaskListOwnerUsernames
{
    /**
     * @return list<string>
     */
    public static function of(CalendarInstance $instance): array
    {
        $owners = [];
        $rows = CalendarInstance::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->get(['principaluri']);
        foreach ($rows as $row) {
            $uri = (string) $row->principaluri;
            if (str_starts_with($uri, AdminConstants::GROUP_PREFIX)) {
                continue;
            }
            if (str_starts_with($uri, 'principals/')) {
                $username = strtolower(substr($uri, strlen('principals/')));
                if ($username !== '' && ! str_contains($username, '/')) {
                    $owners[$username] = $username;
                }
            }
        }

        $principalUri = (string) $instance->principaluri;
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            $members = GroupMember::query()
                ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
                ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
                ->where('g.uri', $principalUri)
                ->pluck('m.uri');
            foreach ($members as $uri) {
                $username = strtolower(str_replace('principals/', '', (string) $uri));
                if ($username !== '') {
                    $owners[$username] = $username;
                }
            }
        }

        return array_values($owners);
    }
}
