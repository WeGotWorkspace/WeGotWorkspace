<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Rtc\RtcRelayService;
use App\Services\Rtc\RtcSettingsService;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcNetClass;
use App\Services\Rtc\Signaling\RtcPeerCaps;
use App\Services\Rtc\Signaling\RtcSignalingException;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Http\Request;

/**
 * HTTP signaling for docs WebRTC mesh.
 *
 * Contract C5: authorization runs on the canonical room (drive path or note UID),
 * while the signaling tables are keyed by `CollabRoomPolicy::roomKey()` so any
 * path length or character set fits `collab_peers.room` / `collab_messages.room`.
 */
final class DocCollabSignalingService
{
    private const MAX_PEERS_PER_ROOM = 20;

    private readonly HttpSignalingStore $store;

    public function __construct(
        private CollabActorResolver $actors,
        private CollabRoomPolicy $rooms,
        private CollabJoinAuthorizer $joinAuthorizer,
        private RtcSettingsService $rtcSettingsService,
        private RtcRelayService $relays,
    ) {
        $this->store = new HttpSignalingStore(RtcSignalingPolicy::collab());
    }

    /**
     * @return array{stunUrls: string, turnAvailable: bool}
     */
    public function rtcSettings(Request $request): array
    {
        return $this->run(function () use ($request): array {
            $this->actors->requireUsername($request);

            return $this->rtcSettingsService->publicSettings();
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{turn: array{urls: list<string>, username: string, credential: string, ttl: int}}
     */
    public function relay(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $roomKey = $this->rooms->roomKey($this->rooms->cleanRoom($body['room'] ?? null));

            return $this->relays->issue($this->store, 'collab', $roomKey, $ownerMarker, $body);
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{peerId: string, peers: list<array{id: string, name: string}>}
     */
    public function join(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRowsSampled();

            $principal = $this->actors->requirePrincipal($request);
            $ownerMarker = $this->actors->ownerMarker($principal['username']);
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $this->joinAuthorizer->assertMayJoin($room, $principal);
            $roomKey = $this->rooms->roomKey($room);
            $name = mb_substr(trim((string) ($body['name'] ?? '')), 0, 64);
            if ($name === '') {
                $this->fail('name_required');
            }

            $peerId = bin2hex(random_bytes(8));
            $now = time();
            $this->store->deleteOwnedPeersExcept($roomKey, $ownerMarker);
            // The access right is computed here and nowhere else: the column
            // defaults to read, so a row that never saw this write cannot edit.
            // It is resolved from the canonical path, while the peer row lives
            // under the hashed room key.
            $this->store->upsertPeer($roomKey, $peerId, $name, $ownerMarker, $now, $this->readBrowserId($body), [
                'caps' => RtcPeerCaps::encode($body['caps'] ?? null),
                'net' => RtcNetClass::normalize($body['net'] ?? null),
                'access' => $this->joinAuthorizer->accessFor($room, $principal),
            ]);

            if ($this->store->countPeers($roomKey) > self::MAX_PEERS_PER_ROOM) {
                $this->store->deletePeer($roomKey, $peerId);
                $this->fail('room_full', 409);
            }

            return [
                'peerId' => $peerId,
                'peers' => $this->store->peerList($roomKey, $peerId),
            ];
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{peers: list<array{id: string, name: string}>, messages: list<array<string, mixed>>, rosterSig: string}|array{unchanged: true, rosterSig: string}
     */
    public function poll(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRowsSampled();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $roomKey = $this->rooms->roomKey($this->rooms->cleanRoom($body['room'] ?? null));
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($roomKey, $peerId, $ownerMarker);

            $knownRosterSig = is_string($body['sig'] ?? null) ? (string) $body['sig'] : null;

            return $this->store->poll($roomKey, $peerId, max(0, (int) ($body['since'] ?? 0)), $knownRosterSig);
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true}
     */
    public function send(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRowsSampled();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $roomKey = $this->rooms->roomKey($this->rooms->cleanRoom($body['room'] ?? null));
            $from = $this->store->readSendFrom($body);
            $to = $this->store->cleanPeer($body['to'] ?? null);
            $this->store->assertPeerOwnedByActor($roomKey, $from, $ownerMarker);

            $type = (string) ($body['type'] ?? '');
            $this->store->send($roomKey, $from, $to, $type, $body['payload'] ?? null);

            return ['ok' => true];
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true}
     */
    public function leave(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRowsSampled();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $roomKey = $this->rooms->roomKey($this->rooms->cleanRoom($body['room'] ?? null));
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($roomKey, $peerId, $ownerMarker);
            $this->store->leave($roomKey, $peerId);

            return ['ok' => true];
        });
    }

    /**
     * Browser-profile token from the client. Invalid or missing values are
     * stored as empty — eviction on it is a later Docs change.
     *
     * @param  array<string, mixed>  $body
     */
    private function readBrowserId(array $body): ?string
    {
        $raw = $body['browserId'] ?? null;

        return is_string($raw) && preg_match('/^[a-f0-9]{32}$/', $raw) === 1 ? $raw : null;
    }

    /**
     * @template T
     *
     * @param  callable(): T  $action
     * @return T
     */
    private function run(callable $action)
    {
        try {
            return $action();
        } catch (RtcSignalingException $exception) {
            throw new CollabResponseException($exception->status, $exception->payload);
        }
    }

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new CollabResponseException($status, $payload);
    }
}
