<?php

declare(strict_types=1);

namespace App\Services\Principal;

use App\Services\Teams\TeamColleagues;

/**
 * Room validation + access check for principal presence rooms.
 *
 * Decoded principal rooms (the part after the `p_` prefix) have one form:
 * `groups.{slug}`, the Team `principals/groups/{slug}`; only its members may join.
 * Presence follows Teams (#1921), so a user sees only colleagues from their own
 * Teams online. The old instance-wide `workspace` room is refused for everyone,
 * admins included, like any other room name.
 */
final class PrincipalRoomAuthorizer
{
    private const GROUP_ROOM_PREFIX = 'groups.';

    public function __construct(private TeamColleagues $teams) {}

    public function cleanRoom(mixed $room): string
    {
        if (! is_string($room) || preg_match('/^[A-Za-z0-9._-]{1,150}$/', $room) !== 1) {
            throw new PrincipalResponseException(400, ['error' => 'invalid_room']);
        }

        return $room;
    }

    public function assertMayJoin(string $room, string $username): void
    {
        if (str_starts_with($room, self::GROUP_ROOM_PREFIX)) {
            $slug = substr($room, strlen(self::GROUP_ROOM_PREFIX));
            if ($slug !== '' && $this->teams->isOwnTeam($username, $slug)) {
                return;
            }
        }

        throw new PrincipalResponseException(403, [
            'error' => 'forbidden',
            'message' => 'You do not have access to this presence room.',
        ]);
    }
}
