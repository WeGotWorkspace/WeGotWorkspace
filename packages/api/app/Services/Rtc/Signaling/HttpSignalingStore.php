<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

final class HttpSignalingStore
{
    /** Same-owner rejoins within this window keep the previous peer pollable (simultaneous tab open). */
    private const JOIN_GRACE_SECONDS = 15;

    /** Fallback sampling rate for {@see pruneOldRowsSampled()}. */
    private const PRUNE_ONE_IN = 20;

    public function __construct(
        private readonly RtcSignalingPolicy $policy,
    ) {}

    public function policy(): RtcSignalingPolicy
    {
        return $this->policy;
    }

    /**
     * Pruning is a room-wide sweep, so it does not belong on the hot poll path:
     * one request in twenty carries it, and the scheduler sweeps what the
     * sampling misses. Both legs ride the `seen_at` / `created_at` indexes.
     */
    public function pruneOldRowsSampled(): void
    {
        $oneIn = max(1, (int) config('wgw.rtc.prune_one_in', self::PRUNE_ONE_IN));
        if ($oneIn > 1 && random_int(1, $oneIn) !== 1) {
            return;
        }

        $this->pruneOldRows();
    }

    public function countStalePeers(?int $now = null): int
    {
        return $this->peerQuery()
            ->where('seen_at', '<', ($now ?? time()) - $this->policy->peerTimeoutSeconds)
            ->count();
    }

    public function pruneOldRows(): void
    {
        $cutoff = time() - $this->policy->peerTimeoutSeconds;
        $stalePeerIds = $this->peerQuery()
            ->where('seen_at', '<', $cutoff)
            ->pluck('peer_id')
            ->all();

        if ($stalePeerIds !== []) {
            $this->peerQuery()->whereIn('peer_id', $stalePeerIds)->delete();
            $this->messageQuery()
                ->where(function ($query) use ($stalePeerIds): void {
                    $query->whereIn('from_peer', $stalePeerIds)->orWhereIn('to_peer', $stalePeerIds);
                })
                ->delete();
        }

        $messageCutoff = time() - $this->policy->messageRetentionSeconds;
        $this->messageQuery()
            ->where('created_at', '<', $messageCutoff)
            ->delete();
    }

    /**
     * @param  array{caps?: string, net?: string, access?: string}  $facts
     *                                                                      Join-time facts: advertised capabilities, measured network class, and
     *                                                                      (collab only) the computed access right. The access column defaults to
     *                                                                      `read`, and only this write can widen it.
     */
    public function upsertPeer(
        string $room,
        string $peerId,
        string $name,
        string $ownerMarker,
        int $now,
        ?string $browserId = null,
        array $facts = [],
    ): void {
        $row = [
            'room' => $room,
            'peer_id' => $peerId,
            'name' => $name,
            'owner_user' => $ownerMarker,
            'seen_at' => $now,
        ];
        $update = ['name', 'owner_user', 'seen_at'];
        if ($this->policy->persistBrowserId) {
            $row['browser_id'] = $browserId ?? '';
            $update[] = 'browser_id';
        }
        foreach (['caps', 'net'] as $column) {
            $row[$column] = $facts[$column] ?? '';
            $update[] = $column;
        }
        if ($this->policy->rosterIncludesAccess) {
            $row['access'] = $facts['access'] ?? RtcPeerAccess::READ;
            $update[] = 'access';
        }

        $this->policy->peerModelClass::upsert([$row], ['room', 'peer_id'], $update);
    }

    /**
     * Re-resolved access right for a live peer (contract C2 refresh). The value
     * always comes from the share grant, so a downgrade reaches the roster the
     * other peers read without waiting for a rejoin.
     */
    public function rewriteAccess(string $room, string $peerId, string $access): void
    {
        if (! $this->policy->rosterIncludesAccess) {
            return;
        }

        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->update(['access' => RtcPeerAccess::normalize($access)]);
    }

    /** Measured network class, refreshed when a peer asks for a relay. */
    public function rememberNetClass(string $room, string $peerId, ?string $net): void
    {
        if ($net === null || $net === '') {
            return;
        }

        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->update(['net' => $net]);
    }

    public function countPeers(string $room): int
    {
        return $this->peerQuery()
            ->where('room', $room)
            ->count();
    }

    public function deletePeer(string $room, string $peerId): void
    {
        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->delete();
    }

    /**
     * Drop leftover same-owner peers in this room (crashed/reloaded tabs).
     * Meet must not use this — a user can be in a call from two devices.
     *
     * @return list<string> deleted peer ids
     */
    public function deleteOwnedPeersExcept(string $room, string $ownerMarker, ?string $keepPeerId = null): array
    {
        if ($ownerMarker === '') {
            return [];
        }

        $graceCutoff = time() - self::JOIN_GRACE_SECONDS;
        $query = $this->peerQuery()
            ->where('room', $room)
            ->where('owner_user', $ownerMarker)
            ->where('seen_at', '<', $graceCutoff);
        if ($keepPeerId !== null && $keepPeerId !== '') {
            $query->where('peer_id', '!=', $keepPeerId);
        }

        $staleIds = $query->pluck('peer_id')->all();
        foreach ($staleIds as $id) {
            $this->leave($room, (string) $id);
        }

        return array_values(array_map(static fn ($id): string => (string) $id, $staleIds));
    }

    /**
     * Drop leftover peers from the same browser in this room (reload / second
     * tab). A second device has a different browser id and is left alone.
     *
     * @return list<string> deleted peer ids
     */
    public function deletePeersForBrowser(string $room, string $browserId, string $keepPeerId): array
    {
        if ($browserId === '' || ! $this->policy->persistBrowserId) {
            return [];
        }

        $staleIds = $this->peerQuery()
            ->where('room', $room)
            ->where('browser_id', $browserId)
            ->where('peer_id', '!=', $keepPeerId)
            ->pluck('peer_id')
            ->all();

        foreach ($staleIds as $id) {
            $this->leave($room, (string) $id);
        }

        return array_values(array_map(static fn ($id): string => (string) $id, $staleIds));
    }

    /**
     * Roster for one peer (contract C1). `user` is only ever an account name:
     * a guest owner marker is dropped, and meeting rosters ask for owners only
     * when the polling actor is authenticated, so guests never see member
     * usernames.
     *
     * @return list<array{id: string, name: string, user?: string, access?: string, caps?: list<string>, net?: string}>
     */
    public function peerList(string $room, string $selfId, ?bool $withOwner = null): array
    {
        $withOwner ??= $this->policy->rosterIncludesOwner;
        $columns = ['peer_id as id', 'name', 'caps', 'net', 'owner_user'];
        if ($this->policy->rosterIncludesAccess) {
            $columns[] = 'access';
        }

        return array_values($this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', '!=', $selfId)
            ->get($columns)
            ->map(function ($row) use ($withOwner): array {
                $peer = [
                    'id' => (string) $row->getAttribute('id'),
                    'name' => (string) $row->getAttribute('name'),
                ];
                $owner = (string) ($row->owner_user ?? '');
                if ($withOwner && str_starts_with($owner, 'u:')) {
                    $peer['user'] = $this->ownerUsername($owner);
                }
                if ($this->policy->rosterIncludesAccess) {
                    $peer['access'] = RtcPeerAccess::normalize($row->getAttribute('access'));
                }
                $caps = RtcPeerCaps::decode($row->getAttribute('caps'));
                if ($caps !== []) {
                    $peer['caps'] = $caps;
                }
                $net = trim((string) ($row->getAttribute('net') ?? ''));
                if ($net !== '') {
                    $peer['net'] = $net;
                }

                return $peer;
            })
            ->all());
    }

    /**
     * A peer id is a client-chosen handle, so joining one that another actor
     * already owns must not silently take it over: the mailbox and the slot in
     * the room belong to whoever claimed it first.
     */
    public function assertPeerIdFree(string $room, string $peerId, string $ownerMarker): void
    {
        $owner = $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->value('owner_user');

        if ($owner === null || (string) $owner === '') {
            return;
        }

        if (! hash_equals((string) $owner, $ownerMarker)) {
            throw new RtcSignalingException(409, [
                'error' => 'peer_id_taken',
                'code' => 'peer_id_taken',
                'message' => 'That peer id is in use — join again with a new one.',
            ]);
        }
    }

    /** Strip the `u:` owner marker so rosters carry the plain Sabre username. */
    private function ownerUsername(string $ownerMarker): string
    {
        return str_starts_with($ownerMarker, 'u:') ? substr($ownerMarker, 2) : $ownerMarker;
    }

    public function touchPeer(string $room, string $peerId, ?int $now = null): void
    {
        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->update(['seen_at' => $now ?? time()]);
    }

    public function assertPeerOwnedByActor(string $room, string $peerId, string $ownerMarker): void
    {
        $row = $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->first(['owner_user']);

        if ($row === null) {
            if ($this->policy->unknownPeerWhenMissing) {
                $this->fail('unknown_peer', 404, 'Unknown peer — refresh and join again');
            }
            $this->fail('forbidden', 403);
        }

        $owner = is_string($row->owner_user ?? null) ? $row->owner_user : '';
        if ($owner === '' || ! hash_equals($owner, $ownerMarker)) {
            $this->fail('forbidden', 403);
        }
    }

    /**
     * Marks a knocking peer as admitted (Meet channel-ACL join policy): set
     * when a channel member sends an admit control message; checked when the
     * peer re-joins without the knock name prefix. Lives on the peer row so
     * it dies with the peer (leave/timeout). Only the Meet policy's table
     * carries the column — collab/principal never call these.
     */
    public function markPeerAdmitted(string $room, string $peerId): void
    {
        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->update(['admitted' => true]);
    }

    /** A fresh knock always starts unadmitted, even on a reused peer id. */
    public function clearPeerAdmission(string $room, string $peerId): void
    {
        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->update(['admitted' => false]);
    }

    /**
     * Admission only counts for the actor that knocked: the owner marker must
     * match the peer row, so a stranger cannot ride an admitted peer id.
     */
    public function isPeerAdmitted(string $room, string $peerId, string $ownerMarker): bool
    {
        $row = $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->first(['owner_user', 'admitted']);
        if ($row === null || ! (bool) ($row->admitted ?? false)) {
            return false;
        }

        $owner = is_string($row->owner_user ?? null) ? $row->owner_user : '';

        return $owner !== '' && $ownerMarker !== '' && hash_equals($owner, $ownerMarker);
    }

    public function peerExists(string $room, string $peerId): bool
    {
        return $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->exists();
    }

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
        $this->touchPeer($room, $peerId);

        $mode = $this->pollModeFor($room, $peerId);
        if ($mode === RtcSignalingPollMode::SinceCursor && $this->policy->sinceAckCap !== null) {
            $this->deleteAckedMessages($room, $peerId, $since);
        }

        $peers = $this->peerList($room, $peerId, $withOwner);
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
     * Poll mode for one peer. A capability-gated policy ({@see RtcSignalingPolicy::$sinceAckCap})
     * only hands the cursor to peers that advertised it; everyone else — an old cached
     * client that never acks — keeps delete-on-read and so is not handed its whole
     * mailbox on every poll. Mixed rooms therefore work for both.
     */
    private function pollModeFor(string $room, string $peerId): RtcSignalingPollMode
    {
        $cap = $this->policy->sinceAckCap;
        if ($cap === null) {
            return $this->policy->pollMode;
        }

        $caps = $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->value('caps');

        return RtcPeerCaps::has($caps, $cap)
            ? $this->policy->pollMode
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

    public function send(string $room, string $from, string $to, string $type, mixed $payload): void
    {
        if (! in_array($type, $this->policy->allowedSendTypes, true)) {
            $this->fail('bad_type');
        }

        if ($this->policy->requireLivePeersOnSend) {
            if (! $this->peerExists($room, $from) || ! $this->peerExists($room, $to)) {
                $this->fail('invalid_peer');
            }
        }

        $encoded = json_encode($payload);
        if ($encoded === false || strlen($encoded) > 200_000) {
            $this->fail('payload_too_large', 413);
        }

        $this->policy->messageModelClass::query()->create([
            'room' => $room,
            'from_peer' => $from,
            'to_peer' => $to,
            'type' => $type,
            'payload' => $encoded,
            'created_at' => time(),
        ]);

        if ($this->policy->trimMessagesOnSend) {
            $this->trimMessages($room);
        }

        $this->touchPeer($room, $from);
    }

    /**
     * Server-authored mailbox row. The allowed-type list guards client sends
     * only: `relay-hint` is a server decision, so a client that sends it is
     * answered with `bad_type`.
     *
     * @param  array<string, mixed>  $payload
     */
    public function insertServerMessage(string $room, string $from, string $to, string $type, array $payload): void
    {
        $this->policy->messageModelClass::query()->create([
            'room' => $room,
            'from_peer' => $from,
            'to_peer' => $to,
            'type' => $type,
            'payload' => json_encode($payload, JSON_THROW_ON_ERROR),
            'created_at' => time(),
        ]);
    }

    public function leave(string $room, string $peerId): void
    {
        $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->delete();

        if ($this->policy->leaveDeletesPeerMessages) {
            $this->messageQuery()
                ->where('room', $room)
                ->where(function ($query) use ($peerId): void {
                    $query->where('from_peer', $peerId)->orWhere('to_peer', $peerId);
                })
                ->delete();
        }
    }

    public function cleanPeer(mixed $peer): string
    {
        if (! is_string($peer) || preg_match($this->policy->peerIdPattern, $peer) !== 1) {
            $this->fail('invalid_peer');
        }

        return $peer;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    public function readSendFrom(array $body): string
    {
        $field = $this->policy->sendFromField;

        return $this->cleanPeer($body[$field] ?? null);
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    public function insertMessages(array $rows): void
    {
        if ($rows === []) {
            return;
        }

        $this->policy->messageModelClass::query()->insert($rows);
    }

    /**
     * Peer rows in the room apart from one, with the display name: Meet reads
     * the name to tell a waiting (knocking) row from a participant.
     *
     * @return list<array{id: string, name: string}>
     */
    public function peersInRoomExcept(string $room, string $exceptPeerId): array
    {
        return array_values($this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', '!=', $exceptPeerId)
            ->get(['peer_id', 'name'])
            ->map(static fn ($row): array => [
                'id' => (string) $row->getAttribute('peer_id'),
                'name' => (string) $row->getAttribute('name'),
            ])
            ->all());
    }

    /** Display name on a peer row; null when there is no such row. */
    public function peerName(string $room, string $peerId): ?string
    {
        $row = $this->peerQuery()
            ->where('room', $room)
            ->where('peer_id', $peerId)
            ->first(['name']);

        return $row === null ? null : (string) $row->getAttribute('name');
    }

    /**
     * @return list<object{owner_user: mixed, name: mixed}>
     */
    public function peersInRoom(string $room, int $limit = 32): array
    {
        return array_values($this->peerQuery()
            ->where('room', $room)
            ->limit($limit)
            ->get(['owner_user', 'name'])
            ->map(static function ($row): object {
                return (object) [
                    'owner_user' => $row->getAttribute('owner_user'),
                    'name' => $row->getAttribute('name'),
                ];
            })
            ->all());
    }

    private function trimMessages(string $room): void
    {
        $max = $this->policy->maxMessagesPerRoom;
        if ($max === null) {
            return;
        }

        $count = $this->messageQuery()->where('room', $room)->count();
        if ($count <= $max) {
            return;
        }

        $keepFromId = $this->messageQuery()
            ->where('room', $room)
            ->orderByDesc('id')
            ->offset($max - 1)
            ->value('id');

        if ($keepFromId !== null) {
            $this->messageQuery()
                ->where('room', $room)
                ->where('id', '<', $keepFromId)
                ->delete();
        }
    }

    /** @return Builder<Model> */
    private function peerQuery(): Builder
    {
        return $this->policy->peerModelClass::query();
    }

    /** @return Builder<Model> */
    private function messageQuery(): Builder
    {
        return $this->policy->messageModelClass::query();
    }

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new RtcSignalingException($status, $payload);
    }
}
