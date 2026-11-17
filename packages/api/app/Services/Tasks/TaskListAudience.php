<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarShareInvites;
use App\Services\Settings\GroupMembershipResolver;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Everyone who can see a task list, with their access (#2172): the owner, the
 * members of an owning Team, and every visible sharee, with a Team grant
 * expanded to its members. The highest access wins when someone comes from two
 * sources. Hidden grants (Epic #1915) and disabled accounts are left out.
 *
 * One answer for assignee validation, the assignee picker and assignment
 * notifications. It is computed per call and never cached, so Team changes
 * show on the next request.
 */
final class TaskListAudience
{
    public const ACCESS_READ = 'read';

    public const ACCESS_WRITE = 'write';

    public function __construct(
        private readonly CalendarShareInvites $shareInvites,
        private readonly GroupMembershipResolver $groupMembers,
    ) {}

    /**
     * Keyed by username, ordered by display name.
     *
     * @return array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>
     */
    public function forList(CalendarInstance $list): array
    {
        $ownerRows = $this->ownerRows($list);
        $access = [];
        foreach ($ownerRows as $row) {
            foreach ($this->usernamesForPrincipalUri((string) $row->principaluri) as $username) {
                $access[$username] = self::ACCESS_WRITE;
            }
        }

        $owner = $ownerRows[0] ?? null;
        $grants = $owner !== null ? ($this->shareInvites->shareWithForOwner($owner, null) ?? []) : [];
        foreach ($grants as $id => $rights) {
            $level = $rights['mayWrite'] ? self::ACCESS_WRITE : self::ACCESS_READ;
            $principalUri = str_starts_with((string) $id, 'groups/')
                ? AdminConstants::GROUP_PREFIX.substr((string) $id, strlen('groups/'))
                : 'principals/'.$id;
            foreach ($this->usernamesForPrincipalUri($principalUri) as $username) {
                if (($access[$username] ?? null) !== self::ACCESS_WRITE) {
                    $access[$username] = $level;
                }
            }
        }

        return $this->withProfiles($access);
    }

    /**
     * The people on the list's owner rows: the owner of a personal list. A
     * Team-owned list has no owner person, so this is empty for it.
     *
     * @return list<string>
     */
    public function ownerUsernames(CalendarInstance $list): array
    {
        $owners = [];
        foreach ($this->ownerRows($list) as $row) {
            $uri = (string) $row->principaluri;
            if (! str_starts_with($uri, AdminConstants::GROUP_PREFIX)) {
                $owners = [...$owners, ...$this->usernamesForPrincipalUri($uri)];
            }
        }

        return array_values(array_unique($owners));
    }

    /**
     * @return list<CalendarInstance>
     */
    private function ownerRows(CalendarInstance $list): array
    {
        return array_values(CalendarInstance::query()
            ->where('calendarid', (int) $list->calendarid)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->orderBy('id')
            ->get()
            ->all());
    }

    /**
     * @return list<string>
     */
    private function usernamesForPrincipalUri(string $principalUri): array
    {
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return array_values(array_filter(array_map(
                self::usernameFromUserUri(...),
                $this->groupMembers->memberPrincipalUris($principalUri),
            )));
        }
        $username = self::usernameFromUserUri($principalUri);

        return $username !== null ? [$username] : [];
    }

    private static function usernameFromUserUri(string $principalUri): ?string
    {
        if (preg_match('#^principals/([^/]+)$#', trim($principalUri), $matches) !== 1 || $matches[1] === 'groups') {
            return null;
        }

        return strtolower($matches[1]);
    }

    /**
     * @param  array<string, 'read'|'write'>  $access
     * @return array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>
     */
    private function withProfiles(array $access): array
    {
        if ($access === []) {
            return [];
        }
        $usernames = array_keys($access);
        $disabled = array_flip(array_map(
            static fn (mixed $username): string => strtolower((string) $username),
            User::query()->whereIn('username', $usernames)->where('enabled', false)->pluck('username')->all(),
        ));
        $principals = Principal::query()
            ->whereIn('uri', array_map(static fn (string $username): string => 'principals/'.$username, $usernames))
            ->get(['uri', 'email', 'displayname'])
            ->keyBy(static fn (Principal $principal): string => strtolower(substr((string) $principal->uri, strlen('principals/'))));

        $members = [];
        foreach ($access as $username => $level) {
            $principal = $principals->get($username);
            if ($principal === null || isset($disabled[$username])) {
                continue;
            }
            $email = is_string($principal->email) && trim($principal->email) !== '' ? trim($principal->email) : null;
            $name = is_string($principal->displayname) && trim($principal->displayname) !== '' ? trim($principal->displayname) : $username;
            $members[$username] = [
                'username' => $username,
                'displayName' => $name,
                'email' => $email,
                'access' => $level,
            ];
        }
        uasort($members, static fn (array $a, array $b): int => strcasecmp($a['displayName'], $b['displayName'])
            ?: strcmp($a['username'], $b['username']));

        return $members;
    }
}
