<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Push state of the `RtcRoom` type (#2294, docs/architecture/jmap-push.md): the doorbell for
 * signaling rooms. It says *that* a room the caller is in changed; the room then polls its
 * mailbox once. Offers, answers and ICE stay on the room's own route.
 *
 * Only rooms where the caller has a live peer count (`owner_user` = the caller, `seen_at`
 * within the channel's peer timeout), so the state never reflects a room the caller has not
 * joined. Per room it covers the roster signature the room poll uses
 * ({@see HttpSignalingMailbox::rosterSignature()}, without `seen_at`: heartbeats do not ring)
 * over the live peers, and the newest message addressed to one of the caller's peers.
 *
 * Per channel table: one read of the live peers in the caller's rooms, and one of the newest
 * message per caller peer, both on indexes.
 */
final class RtcRoomPushState
{
    /** @var array<string, HttpSignalingStore> keyed by channel name */
    private array $stores;

    public function __construct()
    {
        $this->stores = [
            'collab' => new HttpSignalingStore(RtcSignalingPolicy::collab()),
            'principal' => new HttpSignalingStore(RtcSignalingPolicy::principal()),
            'meet' => new HttpSignalingStore(RtcSignalingPolicy::meet()),
        ];
    }

    public function stateFor(string $username, ?int $now = null): string
    {
        $now ??= time();
        $owner = 'u:'.$username;
        $lines = [];
        foreach ($this->stores as $channel => $store) {
            foreach ($this->roomDigests($store, $owner, $now) as $room => $digest) {
                $lines[] = $channel."\x1f".$room."\x1f".$digest;
            }
        }
        if ($lines === []) {
            return '0';
        }
        sort($lines, SORT_STRING);

        return count($lines).'.'.substr(hash('sha256', implode("\x1e", $lines)), 0, 32);
    }

    /**
     * @return array<string, string> room => roster signature + newest message id to the caller
     */
    private function roomDigests(HttpSignalingStore $store, string $owner, int $now): array
    {
        $policy = $store->policy();
        $cutoff = $now - $policy->peerTimeoutSeconds;
        $own = $policy->peerModelClass::query()
            ->where('owner_user', $owner)
            ->where('seen_at', '>=', $cutoff)
            ->get(['room', 'peer_id']);
        if ($own->isEmpty()) {
            return [];
        }
        $rooms = array_values(array_unique($own->map(fn (Model $row): string => (string) $row->getAttribute('room'))->all()));

        $rosters = [];
        $peers = $policy->peerModelClass::query()
            ->whereIn('room', $rooms)
            ->where('seen_at', '>=', $cutoff)
            ->get(['room', ...$store->rosterColumns()]);
        foreach ($peers as $peer) {
            $rosters[(string) $peer->getAttribute('room')][] = $store->rosterEntry($peer, true);
        }

        $newest = $policy->messageModelClass::query()
            ->where(function (Builder $query) use ($own): void {
                foreach ($own as $row) {
                    $query->orWhere(function (Builder $pair) use ($row): void {
                        $pair->where('room', $row->getAttribute('room'))
                            ->where('to_peer', $row->getAttribute('peer_id'));
                    });
                }
            })
            ->groupBy('room')
            ->selectRaw('room, MAX(id) as newest')
            ->toBase()
            ->get();
        $newestByRoom = [];
        foreach ($newest as $row) {
            $newestByRoom[(string) $row->room] = (int) $row->newest;
        }

        $digests = [];
        foreach ($rooms as $room) {
            $digests[$room] = HttpSignalingMailbox::rosterSignature($rosters[$room] ?? [])
                .'.'.($newestByRoom[$room] ?? 0);
        }

        return $digests;
    }
}
