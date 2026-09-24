<?php

declare(strict_types=1);

namespace App\Services\Principal;

use App\Services\Admin\AdminConstants;
use App\Services\Settings\GroupDirectoryService;

/**
 * Room validation + access check for principal presence rooms.
 *
 * Decoded principal rooms (the part after the `p_` prefix) have two known forms:
 *
 * - `workspace` — the workspace-wide room; any authenticated user may join.
 * - `groups.{slug}` — addresses the Sabre group principal `principals/groups/{slug}`;
 *   only members of that group may join.
 *
 * Anything else is denied.
 */
final class PrincipalRoomAuthorizer
{
    public const WORKSPACE_ROOM = 'workspace';

    private const GROUP_ROOM_PREFIX = 'groups.';

    public function __construct(private GroupDirectoryService $groups) {}

    public function cleanRoom(mixed $room): string
    {
        if (! is_string($room) || preg_match('/^[A-Za-z0-9._-]{1,150}$/', $room) !== 1) {
            throw new PrincipalResponseException(400, ['error' => 'invalid_room']);
        }

        return $room;
    }

    public function assertMayJoin(string $room, string $username): void
    {
        if ($room === self::WORKSPACE_ROOM) {
            return;
        }

        if (str_starts_with($room, self::GROUP_ROOM_PREFIX)) {
            $slug = substr($room, strlen(self::GROUP_ROOM_PREFIX));
            if ($slug !== '' && $this->isGroupMember($slug, $username)) {
                return;
            }
        }

        throw new PrincipalResponseException(403, [
            'error' => 'forbidden',
            'message' => 'You do not have access to this presence room.',
        ]);
    }

    private function isGroupMember(string $slug, string $username): bool
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$slug;
        $members = $this->groups->memberPrincipalUris($groupUri);

        return in_array('principals/'.$username, $members, true);
    }
}
