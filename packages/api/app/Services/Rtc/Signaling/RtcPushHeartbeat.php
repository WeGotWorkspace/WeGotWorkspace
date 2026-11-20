<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

/**
 * The push read as the room heartbeat (#2287).
 *
 * Behind the push doorbell a quiet room does not poll, so nothing else moves its
 * peers' `seen_at`. The browser names its own live peers on every push read
 * (`X-WGW-Rtc-Peers: collab:<peerId>,meet:<peerId>,…`) and this refreshes
 * exactly those: one UPDATE per channel, scoped to the named ids and to the
 * caller's owner marker. Another device's peers are never named by this browser,
 * so a closed laptop still expires after `peerTimeoutSeconds`; another user's
 * peer id refreshes nothing.
 */
final class RtcPushHeartbeat
{
    public const HEADER = 'X-WGW-Rtc-Peers';

    /** More than any browser holds at once (a few tabs × collab, presence and Meet). */
    public const MAX_PEERS = 32;

    private const MAX_HEADER_LENGTH = 4096;

    /**
     * Peer ids by channel from the header; malformed or unknown entries are dropped,
     * so a bad header never fails the push read.
     *
     * @return array<string, list<string>>
     */
    public static function parse(?string $header): array
    {
        if ($header === null || $header === '' || strlen($header) > self::MAX_HEADER_LENGTH) {
            return [];
        }
        $byChannel = [];
        $count = 0;
        foreach (explode(',', $header) as $entry) {
            [$channel, $peerId] = array_pad(explode(':', trim($entry), 2), 2, '');
            $policy = self::policy($channel);
            if ($policy === null || preg_match($policy->peerIdPattern, $peerId) !== 1) {
                continue;
            }
            if (isset($byChannel[$channel]) && in_array($peerId, $byChannel[$channel], true)) {
                continue;
            }
            $byChannel[$channel][] = $peerId;
            if (++$count >= self::MAX_PEERS) {
                break;
            }
        }

        return $byChannel;
    }

    /**
     * Refreshes the named peers the caller owns; returns how many rows moved.
     */
    public function refresh(string $username, ?string $header, ?int $now = null): int
    {
        $byChannel = self::parse($header);
        if ($byChannel === []) {
            return 0;
        }
        $now ??= time();
        $owner = 'u:'.$username;
        $moved = 0;
        foreach ($byChannel as $channel => $peerIds) {
            $policy = self::policy($channel);
            if ($policy === null) {
                continue;
            }
            $moved += $policy->peerModelClass::query()
                ->whereIn('peer_id', $peerIds)
                ->where('owner_user', $owner)
                ->update(['seen_at' => $now]);
        }

        return $moved;
    }

    private static function policy(string $channel): ?RtcSignalingPolicy
    {
        return match ($channel) {
            'collab' => RtcSignalingPolicy::collab(),
            'principal' => RtcSignalingPolicy::principal(),
            'meet' => RtcSignalingPolicy::meet(),
            default => null,
        };
    }
}
