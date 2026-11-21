<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

use App\Services\Collab\DocCollabSignalingService;
use App\Services\Principal\PrincipalSignalingService;

/**
 * The push read as the room heartbeat (#2287).
 *
 * Behind the push doorbell a quiet room does not poll, so nothing else moves its
 * peers' `seen_at`. The browser names its own live peers on every push read
 * (`X-WGW-Rtc-Peers: collab:<peerId>,meet:<peerId>,…`) and this refreshes
 * exactly those, scoped to the caller's owner marker. Another device's peers are
 * never named by this browser, so a closed laptop still expires after
 * `peerTimeoutSeconds`; another user's peer id refreshes nothing.
 *
 * A peer is refreshed at most every {@see self::RECHECK_SECONDS}; a fresher one
 * costs no write. Collab and presence rooms re-check access on every poll, so the
 * refresh runs the same check first ({@see DocCollabSignalingService::recheckForPushHeartbeat()},
 * {@see PrincipalSignalingService::recheckForPushHeartbeat()}): a revoked share, a
 * downgrade or a removed Team member reaches the room within that interval, as it
 * did with the 30 s heartbeat poll. Meet's poll does not re-check membership, so
 * neither does this.
 */
final class RtcPushHeartbeat
{
    public const HEADER = 'X-WGW-Rtc-Peers';

    /** More than any browser holds at once (a few tabs × collab, presence and Meet). */
    public const MAX_PEERS = 32;

    /**
     * How often a named peer is refreshed and its access re-checked. Well inside
     * every channel's peer timeout (Meet 60 s, collab and presence 90 s), and the
     * bound the 30 s heartbeat poll gave a revoked share before.
     */
    public const RECHECK_SECONDS = 30;

    private const MAX_HEADER_LENGTH = 4096;

    public function __construct(
        private readonly DocCollabSignalingService $collab,
        private readonly PrincipalSignalingService $principal,
    ) {}

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
     * Refreshes the named peers the caller owns that are due, after the access
     * check of their room; returns how many rows moved.
     *
     * @param  array{username: string, role: string}  $principal
     */
    public function refresh(array $principal, ?string $header, ?int $now = null): int
    {
        $byChannel = self::parse($header);
        if ($byChannel === []) {
            return 0;
        }
        $now ??= time();
        $owner = 'u:'.$principal['username'];
        $moved = 0;
        foreach ($byChannel as $channel => $peerIds) {
            $policy = self::policy($channel);
            if ($policy === null) {
                continue;
            }
            $due = $policy->peerModelClass::query()
                ->whereIn('peer_id', $peerIds)
                ->where('owner_user', $owner)
                ->where('seen_at', '<', $now - self::RECHECK_SECONDS)
                ->get();
            $keep = [];
            $rooms = [];
            foreach ($due as $row) {
                $room = (string) $row->getAttribute('room');
                $peerId = (string) $row->getAttribute('peer_id');
                $mayStay = match ($channel) {
                    'collab' => $this->recheckCollab($principal, $room, $row->getAttribute('room_path'), $peerId),
                    'principal' => $rooms[$room] ??= $this->recheck(fn (): bool => $this->principal->recheckForPushHeartbeat($principal['username'], $room)),
                    default => true,
                };
                if ($mayStay) {
                    $keep[] = $peerId;
                }
            }
            if ($keep === []) {
                continue;
            }
            $moved += $policy->peerModelClass::query()
                ->whereIn('peer_id', $keep)
                ->where('owner_user', $owner)
                ->update(['seen_at' => $now]);
        }

        return $moved;
    }

    /**
     * @param  array{username: string, role: string}  $principal
     */
    private function recheckCollab(array $principal, string $roomKey, mixed $roomPath, string $peerId): bool
    {
        // A row from before `room_path` cannot be re-checked: let it expire.
        if (! is_string($roomPath) || $roomPath === '') {
            return false;
        }

        return $this->recheck(fn (): bool => $this->collab->recheckForPushHeartbeat($principal, $roomKey, $roomPath, $peerId));
    }

    /**
     * A failing check never fails the push read; the peer is just not kept alive.
     *
     * @param  callable(): bool  $check
     */
    private function recheck(callable $check): bool
    {
        try {
            return $check();
        } catch (\Throwable $error) {
            report($error);

            return false;
        }
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
