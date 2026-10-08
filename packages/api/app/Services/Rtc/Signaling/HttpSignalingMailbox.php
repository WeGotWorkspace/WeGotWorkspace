<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Poll and ack for one signaling mailbox.
 *
 * Split out of {@see HttpSignalingStore} so the store stays under the
 * file-size ceiling. The store still owns peer rows; this class owns the
 * cursor, the delete-on-read drain, and the roster signature those reads use.
 */
final class HttpSignalingMailbox
{
    public function __construct(private readonly HttpSignalingStore $store) {}

    /**
     * Poll roster + pending messages. When the caller echoes the roster signature of a
     * previous poll (`$knownRosterSig`) and neither the roster nor the peer's mailbox
     * changed, a minimal `{unchanged: true}` marker is returned and payload building
     * (message fetch/delete, roster serialization) is skipped. The ack runs before that
     * fast path, so a 204 still shrinks the mailbox.
     *
     * @return array{peers: list<array{id: string, name: string, user?: string}>, messages: list<array<string, mixed>>, rosterSig: string}|array{unchanged: true, rosterSig: string}
     */
    public function poll(
        string $room,
        string $peerId,
        int $since = 0,
        ?string $knownRosterSig = null,
        ?bool $withOwner = null,
    ): array {
        $this->store->touchPeer($room, $peerId);

        $mode = $this->pollModeFor($room, $peerId);
        if ($mode === RtcSignalingPollMode::SinceCursor && $this->store->policy()->sinceAckCap !== null) {
            $this->deleteAckedMessages($room, $peerId, $since);
        }

        $peers = $this->store->peerList($room, $peerId, $withOwner);
        $rosterSig = $this->rosterSignature($peers);

        if (
            $knownRosterSig !== null
            && $knownRosterSig !== ''
            && hash_equals($rosterSig, $knownRosterSig)
            && ! $this->hasPendingMessages($room, $peerId, $since, $mode)
        ) {
            return ['unchanged' => true, 'rosterSig' => $rosterSig];
        }

        return [
            'peers' => $peers,
            'messages' => $mode === RtcSignalingPollMode::SinceCursor
                ? $this->messagesSinceCursor($room, $peerId, $since)
                : $this->messagesDeletingOnRead($room, $peerId),
            'rosterSig' => $rosterSig,
        ];
    }

    /**
     * Pending mailbox for the sender, same fields as a full poll, without
     * deleting. A send response piggybacks this so the client can apply it
     * immediately. Delete-on-read clients that ignore the extra fields still
     * find the rows on their next poll.
     *
     * @return array{peers: list<array{id: string, name: string, user?: string, access?: string, caps?: list<string>, net?: string}>, messages: list<array{id: int, from: string, to: string, type: string, payload: mixed}>, rosterSig: string}
     */
    public function pendingMailbox(string $room, string $peerId, ?bool $withOwner = null): array
    {
        $peers = $this->store->peerList($room, $peerId, $withOwner);

        return [
            'peers' => $peers,
            'messages' => $this->messagesSinceCursor($room, $peerId, 0),
            'rosterSig' => $this->rosterSignature($peers),
        ];
    }

    /**
     * Poll mode for one peer. A capability-gated policy ({@see RtcSignalingPolicy::$sinceAckCap})
     * only hands the cursor to peers that advertised it; everyone else — an old cached
     * client that never acks — keeps delete-on-read and so is not handed its whole
     * mailbox on every poll. Mixed rooms therefore work for both.
     */
    private function pollModeFor(string $room, string $peerId): RtcSignalingPollMode
    {
        $policy = $this->store->policy();
        $cap = $policy->sinceAckCap;
        if ($cap === null) {
            return $policy->pollMode;
        }

        $caps = $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->value('caps');

        return RtcPeerCaps::has($caps, $cap)
            ? $policy->pollMode
            : RtcSignalingPollMode::DeleteOnRead;
    }

    /**
     * `since` is an ack, not just a filter: everything the peer confirmed having read
     * is dropped here, which is what lets the rows above the cursor be redelivered
     * after a lost poll response.
     */
    private function deleteAckedMessages(string $room, string $peerId, int $since): void
    {
        if ($since <= 0) {
            return;
        }

        $this->messageQuery()
            ->where('room', $room)
            ->where('to_peer', $peerId)
            ->where('id', '<=', $since)
            ->delete();
    }

    /**
     * @return list<array{id: int, from: string, to: string, type: string, payload: mixed}>
     */
    private function messagesSinceCursor(string $room, string $peerId, int $since): array
    {
        $rows = $this->messageQuery()
            ->where('room', $room)
            ->where('to_peer', $peerId)
            ->where('id', '>', max(0, $since))
            ->orderBy('id')
            ->get(['id', 'from_peer as from', 'to_peer as to', 'type', 'payload']);

        $messages = [];
        foreach ($rows as $row) {
            $messages[] = [
                'id' => (int) $row->getAttribute('id'),
                'from' => (string) $row->getAttribute('from'),
                'to' => (string) $row->getAttribute('to'),
                'type' => (string) $row->getAttribute('type'),
                'payload' => json_decode((string) $row->getAttribute('payload'), true),
            ];
        }

        return $messages;
    }

    /**
     * @return list<array{from: string, type: string, payload: mixed}>
     */
    private function messagesDeletingOnRead(string $room, string $peerId): array
    {
        $rows = $this->messageQuery()
            ->where('room', $room)
            ->where('to_peer', $peerId)
            ->orderBy('id')
            ->get(['id', 'from_peer as from', 'type', 'payload']);

        if ($rows->isEmpty()) {
            return [];
        }

        $this->messageQuery()->whereIn('id', $rows->pluck('id')->all())->delete();

        $messages = [];
        foreach ($rows as $row) {
            $messages[] = [
                'from' => (string) $row->getAttribute('from'),
                'type' => (string) $row->getAttribute('type'),
                'payload' => json_decode((string) $row->getAttribute('payload'), true),
            ];
        }

        return $messages;
    }

    /**
     * Signature over the visible roster (ids, names, owner, and the C1 facts,
     * order-independent). `seen_at` is deliberately excluded — it changes on
     * every poll touch.
     *
     * @param  list<array{id: string, name: string, user?: string, access?: string, caps?: list<string>, net?: string}>  $peers
     */
    private function rosterSignature(array $peers): string
    {
        $parts = array_map(
            static fn (array $peer): string => implode("\x1f", [
                $peer['id'],
                $peer['name'],
                $peer['user'] ?? '',
                $peer['access'] ?? '',
                implode(',', $peer['caps'] ?? []),
                $peer['net'] ?? '',
            ]),
            $peers,
        );
        sort($parts, SORT_STRING);

        return sha1(implode("\x1e", $parts));
    }

    private function hasPendingMessages(
        string $room,
        string $peerId,
        int $since,
        RtcSignalingPollMode $mode,
    ): bool {
        $query = $this->messageQuery()
            ->where('room', $room)
            ->where('to_peer', $peerId);

        if ($mode === RtcSignalingPollMode::SinceCursor) {
            $query->where('id', '>', max(0, $since));
        }

        return $query->exists();
    }

    /** @return Builder<Model> */
    private function peerQuery(): Builder
    {
        return $this->store->policy()->peerModelClass::query();
    }

    /** @return Builder<Model> */
    private function messageQuery(): Builder
    {
        return $this->store->policy()->messageModelClass::query();
    }
}
