<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Rtc\RtcSettingsService;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcSignalingException;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Http\Request;

/**
 * HTTP signaling for docs WebRTC mesh.
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
    ) {
        $this->store = new HttpSignalingStore(RtcSignalingPolicy::collab());
    }

    /**
     * @return array{stunUrls: string, turnUrls: string, turnUsername: string, turnPassword: string}
     */
    public function rtcSettings(): array
    {
        return $this->rtcSettingsService->settings();
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{peerId: string, peers: list<array{id: string, name: string}>}
     */
    public function join(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRows();

            $principal = $this->actors->requirePrincipal($request);
            $ownerMarker = $this->actors->ownerMarker($principal['username']);
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $this->joinAuthorizer->assertMayJoin($room, $principal);
            $name = mb_substr(trim((string) ($body['name'] ?? '')), 0, 64);
            if ($name === '') {
                $this->fail('name_required');
            }

            $peerId = bin2hex(random_bytes(8));
            $now = time();
            $this->store->deleteOwnedPeersExcept($room, $ownerMarker);
            $this->store->upsertPeer($room, $peerId, $name, $ownerMarker, $now);

            if ($this->store->countPeers($room) > self::MAX_PEERS_PER_ROOM) {
                $this->store->deletePeer($room, $peerId);
                $this->fail('room_full', 409);
            }

            return [
                'peerId' => $peerId,
                'peers' => $this->store->peerList($room, $peerId),
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
            $this->store->pruneOldRows();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $peerId, $ownerMarker);

            $knownRosterSig = is_string($body['sig'] ?? null) ? (string) $body['sig'] : null;

            return $this->store->poll($room, $peerId, max(0, (int) ($body['since'] ?? 0)), $knownRosterSig);
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true}
     */
    public function send(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRows();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $from = $this->store->readSendFrom($body);
            $to = $this->store->cleanPeer($body['to'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $from, $ownerMarker);

            $type = (string) ($body['type'] ?? '');
            $this->store->send($room, $from, $to, $type, $body['payload'] ?? null);

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
            $this->store->pruneOldRows();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $peerId, $ownerMarker);
            $this->store->leave($room, $peerId);

            return ['ok' => true];
        });
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
