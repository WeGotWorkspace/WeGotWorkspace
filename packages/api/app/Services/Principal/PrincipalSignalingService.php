<?php

declare(strict_types=1);

namespace App\Services\Principal;

use App\Services\Rtc\RtcSettingsService;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcSignalingException;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Http\Request;

/**
 * HTTP signaling for the principal presence mesh (`p_` rooms).
 *
 * Peer identity: the authenticated Sabre username is the owner (stored as
 * `owner_user = u:{username}` and exposed as `user` in the roster — the
 * authoritative identity for clients). The peer id itself is
 * `{sanitized-username}-{6 random hex}`: the prefix is diagnostic, the random
 * suffix keeps multiple tabs of the same user apart.
 */
final class PrincipalSignalingService
{
    private const MAX_PEERS_PER_ROOM = 32;

    private readonly HttpSignalingStore $store;

    public function __construct(
        private PrincipalActorResolver $actors,
        private PrincipalRoomAuthorizer $rooms,
        private RtcSettingsService $rtcSettingsService,
    ) {
        $this->store = new HttpSignalingStore(RtcSignalingPolicy::principal());
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
     * @return array{peerId: string, peers: list<array{id: string, name: string, user?: string}>}
     */
    public function join(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRows();

            $username = $this->actors->requireUsername($request);
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $this->rooms->assertMayJoin($room, $username);

            $name = mb_substr(trim((string) ($body['name'] ?? '')), 0, 64);
            if ($name === '') {
                $name = $username;
            }

            $peerId = $this->makePeerId($username);
            $ownerMarker = $this->actors->ownerMarker($username);
            $this->store->deleteOwnedPeersExcept($room, $ownerMarker);
            $this->store->upsertPeer($room, $peerId, $name, $ownerMarker, time());

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
     * @return array{peers: list<array{id: string, name: string, user?: string}>, messages: list<array<string, mixed>>, rosterSig: string}|array{unchanged: true, rosterSig: string}
     */
    public function poll(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRows();

            $ownerMarker = $this->actors->ownerMarker($this->actors->requireUsername($request));
            $room = $this->rooms->cleanRoom($body['room'] ?? null);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $peerId, $ownerMarker);

            $sig = $body['sig'] ?? null;

            return $this->store->poll(
                $room,
                $peerId,
                max(0, (int) ($body['since'] ?? 0)),
                is_string($sig) && $sig !== '' ? $sig : null,
            );
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
     * Peer id: sanitized username prefix (readability/diagnostics) + random suffix
     * (multi-tab). Characters outside the participantId route charset map to `-`.
     */
    private function makePeerId(string $username): string
    {
        $safe = preg_replace('/[^A-Za-z0-9_-]/', '-', $username) ?? '';
        $safe = substr($safe, 0, 64);
        if ($safe === '') {
            $safe = 'user';
        }

        return $safe.'-'.bin2hex(random_bytes(3));
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
            throw new PrincipalResponseException($exception->status, $exception->payload);
        }
    }

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new PrincipalResponseException($status, $payload);
    }
}
