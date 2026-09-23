<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Chat\ChatCollectionUris;
use Illuminate\Database\Eloquent\Builder;

/**
 * Channel-ACL join policy for meet rooms (Epic #701 chunk H).
 *
 * Room↔channel convention (agreed with the frontend): a call in a chat
 * channel uses the deterministic room id = the channel collection id
 * (`chat-{ulid}` / `dm-…`); meeting-kind channels may additionally carry a
 * stored `room_code` in chat_channel_meta. Both resolve to the channel.
 * That code is the ad-hoc meeting id. Name slugs are for channels and DMs.
 *
 * Policy (enforced in MeetSignalingService join, poll, send, and chat —
 * server-side, not a client naming convention):
 * - authenticated users WITH channel ACL read access (owner / sharee / group
 *   member, via CalendarCollectionAccess through ChatChannelRepository) join
 *   directly and are hosts — every member may admit;
 * - authenticated users WITHOUT access are forced onto the knock path: a
 *   non-knock join is rejected until a member's admit control message marked
 *   the knocking peer as admitted;
 * - guests (no account) never join a named channel, team channel, or direct
 *   message. An ad-hoc meeting is open on its room code (`xxxx-xxxx-xxxx`)
 *   only — not on a name slug. A guest who knocks on that code can be
 *   admitted and then re-join;
 * - any other room, including a plain name with no channel, is closed to
 *   guests. Authenticated callers still join those rooms directly.
 */
final class MeetChannelJoinPolicy
{
    /** Mirrors MEET_CONTROL_PREFIX in packages/apps meet-control-messages.ts. */
    private const CONTROL_MESSAGE_PREFIX = '__wgw_meet_control__:';

    public function __construct(private readonly ChatChannelRepository $channels) {}

    /**
     * Resolves a room id to its chat channel: `chat-`/`dm-` prefixed room ids
     * match the collection uri directly; anything else matches a meeting
     * channel's guest room_code in chat_channel_meta. Null → not a channel
     * room (legacy behavior applies).
     */
    public function resolveChannelForRoom(string $room): ?MeetChannelRoom
    {
        if (ChatCollectionUris::isChatUri($room)) {
            $instance = $this->instanceQuery()->where('uri', $room)->first(['calendarid', 'uri']);
            if ($instance === null) {
                return null;
            }

            return $this->channelRoom((int) $instance->calendarid, $room);
        }

        $meta = ChatChannelMeta::query()->where('room_code', $room)->first(['calendarid']);
        if ($meta === null) {
            return null;
        }
        $instance = $this->instanceQuery()->where('calendarid', (int) $meta->calendarid)->first(['calendarid', 'uri']);
        if ($instance === null) {
            return null;
        }

        return $this->channelRoom((int) $instance->calendarid, (string) $instance->uri);
    }

    /**
     * Shared `/meet/meetings/{id}` lookup: leftover room codes, collection
     * ids (`chat-test`), and public slugs (`test`) resolve to the signaling
     * room when the id is a meeting-kind channel. Null → unknown invite.
     */
    public function resolveMeetingInviteRoom(string $room): ?string
    {
        $id = strtolower(trim($room));
        if ($id === '') {
            return null;
        }
        $candidates = [$id];
        if (! ChatCollectionUris::isChatUri($id)) {
            $candidates[] = ChatCollectionUris::PREFIX_CHANNEL.$id;
        }

        foreach ($candidates as $candidate) {
            $channel = $this->resolveChannelForRoom($candidate);
            if ($channel === null || $channel->isDm) {
                continue;
            }
            $meta = ChatChannelMeta::query()->where('calendarid', $channel->calendarId)->first(['kind', 'room_code']);
            if ($meta === null || $meta->kind !== ChatChannelMeta::KIND_MEETING) {
                continue;
            }
            $guestRoom = is_string($meta->room_code) ? strtolower(trim($meta->room_code)) : '';

            return $guestRoom !== '' ? $guestRoom : $channel->channelUri;
        }

        return null;
    }

    /**
     * True when a guest must not enter this room. Named channels, team
     * channels, direct messages, meeting name slugs, and plain room names
     * are closed. An ad-hoc meeting is open only on its `xxxx-xxxx-xxxx` id.
     */
    public function isGuestClosedRoom(string $room): bool
    {
        $channel = $this->resolveChannelForRoom($room);
        if ($channel !== null) {
            if ($channel->isDm) {
                return true;
            }
            $meta = ChatChannelMeta::query()->where('calendarid', $channel->calendarId)->first(['kind', 'room_code']);
            if ($meta === null || $meta->kind !== ChatChannelMeta::KIND_MEETING) {
                return true;
            }
            $code = is_string($meta->room_code) ? strtolower(trim($meta->room_code)) : '';
            $asked = strtolower(trim($room));

            return ! ($code !== '' && $asked === $code && self::isAdHocMeetingCode($code));
        }

        return ! self::isAdHocMeetingCode($room);
    }

    /** Ad-hoc meeting id. Name slugs never match. */
    public static function isAdHocMeetingCode(string $room): bool
    {
        return preg_match('/^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/', strtolower(trim($room))) === 1;
    }

    /**
     * Channel ACL read access — owner, sharee (dismissals honored), or group
     * member; the exact accessibility rule the REST/JMAP chat surface uses.
     */
    public function isChannelMember(string $username, MeetChannelRoom $channel): bool
    {
        return $this->channels->findAccessibleInstanceForCalendar($username, $channel->calendarId) !== null;
    }

    /**
     * Extracts the admitted peer id when $text is an `admit` control message
     * (see meet-control-messages.ts); null for everything else. Malformed
     * payloads are ignored, never an error — control messages remain a
     * peer-to-peer convention except for this server-side hook.
     */
    public function admittedPeerIdFromControlText(string $text): ?string
    {
        if (! str_starts_with($text, self::CONTROL_MESSAGE_PREFIX)) {
            return null;
        }
        $decoded = json_decode(substr($text, strlen(self::CONTROL_MESSAGE_PREFIX)), true);
        if (! is_array($decoded) || ($decoded['kind'] ?? null) !== 'admit') {
            return null;
        }
        $peerId = $decoded['peerId'] ?? null;

        return is_string($peerId) && $peerId !== '' ? $peerId : null;
    }

    private function channelRoom(int $calendarId, string $uri): MeetChannelRoom
    {
        return new MeetChannelRoom(
            $calendarId,
            $uri,
            str_starts_with($uri, ChatCollectionUris::PREFIX_DM),
        );
    }

    /**
     * @return Builder<CalendarInstance>
     */
    private function instanceQuery()
    {
        return CalendarInstance::query()
            ->whereHas('calendar', fn ($query) => $query->vjournalOnly());
    }
}
