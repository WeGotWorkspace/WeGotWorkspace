<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Models\MeetPeer;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;

/**
 * Push state of the `MeetCall` type (#2295, docs/architecture/jmap-push.md): the doorbell for
 * "a call is running in a channel". It says *that* the set of channels with a call changed;
 * Meet chat then asks `room-status` for the rooms it shows.
 *
 * Rooms are those of the chat channels the caller can access ({@see ChatChannelRepository}
 * rules; DM rooms are chat collections too). A channel's room is its collection id, and for a
 * meeting-kind channel also its stored guest room code, as {@see MeetChannelJoinPolicy::resolveChannelForRoom()}
 * resolves both. A room is active under the same rule as `room-status`: it has a live peer that is
 * an account or a named non-knock guest. The state covers only the set of active rooms, so heartbeats,
 * knocks and activity in channels the caller is not in never move it.
 *
 * Two reads: the room codes of the caller's channels, and the live peers in those rooms (indexed on `room`).
 */
final class MeetCallPushState
{
    private const ROOM_CHUNK = 400;

    /**
     * @param  iterable<CalendarInstance>  $instances  the caller's accessible chat channel collections
     */
    public function stateFor(iterable $instances, ?int $now = null): string
    {
        $rooms = $this->roomsOf($instances);
        if ($rooms === []) {
            return '0';
        }

        $cutoff = ($now ?? time()) - RtcSignalingPolicy::meet()->peerTimeoutSeconds;
        $active = [];
        foreach (array_chunk($rooms, self::ROOM_CHUNK) as $chunk) {
            $peers = MeetPeer::query()
                ->whereIn('room', $chunk)
                ->where('seen_at', '>=', $cutoff)
                ->get(['room', 'owner_user', 'name']);
            foreach ($peers as $peer) {
                if (self::isJoinable($peer->getAttribute('owner_user'), $peer->getAttribute('name'))) {
                    $active[strtolower((string) $peer->getAttribute('room'))] = true;
                }
            }
        }
        if ($active === []) {
            return '0';
        }
        $names = array_keys($active);
        sort($names, SORT_STRING);

        return count($names).'.'.substr(hash('sha256', implode("\x1e", $names)), 0, 32);
    }

    private static function isJoinable(mixed $owner, mixed $name): bool
    {
        if (is_string($owner) && str_starts_with($owner, 'u:')) {
            return true;
        }
        $name = is_string($name) ? trim($name) : '';

        return $name !== '' && ! str_starts_with($name, MeetSignalingService::KNOCK_NAME_PREFIX);
    }

    /**
     * @param  iterable<CalendarInstance>  $instances
     * @return list<string> lower-case room ids
     */
    private function roomsOf(iterable $instances): array
    {
        $rooms = [];
        $calendarIds = [];
        foreach ($instances as $instance) {
            $rooms[strtolower((string) $instance->uri)] = true;
            $calendarIds[] = (int) $instance->calendarid;
        }
        foreach (array_chunk($calendarIds, self::ROOM_CHUNK) as $chunk) {
            $codes = ChatChannelMeta::query()
                ->whereIn('calendarid', $chunk)
                ->whereNotNull('room_code')
                ->pluck('room_code');
            foreach ($codes as $code) {
                if (is_string($code) && $code !== '') {
                    $rooms[strtolower($code)] = true;
                }
            }
        }

        return array_keys($rooms);
    }
}
