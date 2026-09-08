<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Services\Rtc\RtcSettingsService;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcSignalingException;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Http\Request;

final class MeetSignalingService
{
    private const KNOCK_NAME_PREFIX = '__wgw_knock__:';

    private const MAX_PEERS_PER_ROOM = 4;

    private readonly HttpSignalingStore $store;

    public function __construct(
        private MeetActorResolver $actors,
        private RtcSettingsService $rtcSettingsService,
        private MeetReservationService $reservations,
        private MeetChannelJoinPolicy $channelJoinPolicy,
    ) {
        $this->store = new HttpSignalingStore(RtcSignalingPolicy::meet());
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
     * @return array{active: bool}
     */
    public function roomStatus(array $body): array
    {
        return $this->run(function () use ($body): array {
            $this->store->pruneOldRows();
            $room = $this->cleanRoom($body['room'] ?? null);

            return ['active' => $this->roomHasJoinablePeer($room)];
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{peers: list<array{id: string, name: string}>, sessionKey: string|null}
     */
    public function join(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRows();

            $username = $this->actors->tryAuthenticatedUsername($request);
            $room = $this->cleanRoom($body['room'] ?? null);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $name = mb_substr((string) ($body['name'] ?? ''), 0, 64);
            $isKnockRequest = str_starts_with($name, self::KNOCK_NAME_PREFIX);
            $guestSessionKey = null;
            $ownerMarker = $this->actors->ownerMarkerForAuthenticatedUser($username);

            $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
            if ($channel !== null) {
                // Channel-linked room: ACL members join directly (and are
                // hosts); everyone else is forced onto the knock path —
                // server-enforced, not a client naming convention (chunk H).
                if ($ownerMarker === null) {
                    $guestSessionKey = $this->actors->readGuestSessionKey($body) ?? $this->actors->newGuestSessionKey();
                    $ownerMarker = $this->actors->ownerMarkerForGuestSession($guestSessionKey);
                }
                if ($username === null || ! $this->channelJoinPolicy->isChannelMember($username, $channel)) {
                    $this->assertNonMemberChannelJoin($channel, $username, $room, $peerId, $ownerMarker, $isKnockRequest);
                }
            } elseif ($ownerMarker === null) {
                // Non-channel rooms: unknown leftovers stay room_not_active
                // when empty; a reserved leftover invite may knock and wait.
                if ($isKnockRequest && ! $this->roomHasJoinablePeer($room) && ! $this->allowsEmptyGuestKnock($room)) {
                    $this->fail('room_not_active', 404);
                }
                $guestSessionKey = $this->actors->readGuestSessionKey($body) ?? $this->actors->newGuestSessionKey();
                $ownerMarker = $this->actors->ownerMarkerForGuestSession($guestSessionKey);
            }

            $browserId = $this->readBrowserId($body);
            $this->store->upsertPeer($room, $peerId, $name, $ownerMarker, time(), $browserId);
            if ($browserId !== null) {
                $this->store->deletePeersForBrowser($room, $browserId, $peerId);
            }
            if ($channel !== null && $isKnockRequest) {
                // A (re-)knock always starts unadmitted — otherwise a reused
                // peer id could inherit a stale admission.
                $this->store->clearPeerAdmission($room, $peerId);
            }
            if ($this->roomHasJoinablePeer($room)) {
                $this->reservations->markActivated($room);
            }

            if ($this->store->countPeers($room) > self::MAX_PEERS_PER_ROOM) {
                $this->store->deletePeer($room, $peerId);
                $this->fail('room_full', 409);
            }

            return [
                'peers' => $this->store->peerList($room, $peerId),
                'sessionKey' => $guestSessionKey,
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

            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $room = $this->cleanRoom($body['room'] ?? null);
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

            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $room = $this->cleanRoom($body['room'] ?? null);
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

            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $room = $this->cleanRoom($body['room'] ?? null);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $peerId, $ownerMarker);
            $this->store->leave($room, $peerId);

            return ['ok' => true];
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true, delivered: int}
     */
    public function chat(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRows();

            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $room = $this->cleanRoom($body['room'] ?? null);
            $from = $this->store->cleanPeer($body['from'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $from, $ownerMarker);

            $text = trim((string) ($body['text'] ?? ''));
            $text = mb_substr($text, 0, 2000);
            if ($text === '') {
                $this->fail('empty_text');
            }

            if (! $this->store->peerExists($room, $from)) {
                $this->fail('not_in_room');
            }

            $this->recordChannelAdmission($request, $room, $text);

            $payload = json_encode(['text' => $text], JSON_THROW_ON_ERROR);
            if (strlen($payload) > 12_000) {
                $this->fail('payload_too_large', 413);
            }

            $targets = $this->store->peerIdsInRoomExcept($room, $from);

            if ($targets === []) {
                return ['ok' => true, 'delivered' => 0];
            }

            $now = time();
            $rows = [];
            foreach ($targets as $target) {
                $rows[] = [
                    'room' => $room,
                    'from_peer' => $from,
                    'to_peer' => $target,
                    'type' => 'chat',
                    'payload' => $payload,
                    'created_at' => $now,
                ];
            }
            $this->store->insertMessages($rows);

            return ['ok' => true, 'delivered' => count($targets)];
        });
    }

    /**
     * Non-member (guest or authenticated non-member) join on a channel room:
     * knock joins on a known meeting invite may wait in an empty room; other
     * channel rooms still require someone joinable (`room_not_active`).
     * Non-knock joins pass only for a previously admitted peer; guests never
     * enter dm- rooms.
     */
    private function assertNonMemberChannelJoin(
        MeetChannelRoom $channel,
        ?string $username,
        string $room,
        string $peerId,
        string $ownerMarker,
        bool $isKnockRequest,
    ): void {
        if ($username === null && $channel->isDm) {
            $this->fail('forbidden', 403, 'Guests cannot join direct-message calls.');
        }
        if ($isKnockRequest) {
            if (! $this->roomHasJoinablePeer($room) && ! $this->allowsEmptyGuestKnock($room)) {
                $this->fail('room_not_active', 404);
            }

            return;
        }
        if (! $this->store->isPeerAdmitted($room, $peerId, $ownerMarker)) {
            $this->fail('knock_required', 403, 'Only channel members join directly — request to join instead.');
        }
    }

    /**
     * Server-side half of knock admission on channel rooms: when a channel
     * member broadcasts an `admit` control message, the target peer row is
     * marked admitted so its non-knock re-join passes the policy. Non-member
     * and guest senders are ignored (the message still delivers — control
     * messages stay a client convention on non-channel rooms and for
     * everything except this hook).
     */
    private function recordChannelAdmission(Request $request, string $room, string $text): void
    {
        $peerId = $this->channelJoinPolicy->admittedPeerIdFromControlText($text);
        if ($peerId === null) {
            return;
        }
        $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
        if ($channel === null) {
            return;
        }
        $username = $this->actors->tryAuthenticatedUsername($request);
        if ($username === null || ! $this->channelJoinPolicy->isChannelMember($username, $channel)) {
            return;
        }

        $this->store->markPeerAdmitted($room, $peerId);
    }

    /** Known `/meet/meetings/{id}` invite (meeting collection or reserved leftover). */
    private function allowsEmptyGuestKnock(string $room): bool
    {
        if ($this->channelJoinPolicy->resolveMeetingInviteRoom($room) !== null) {
            return true;
        }

        return $this->reservations->find($room) !== null;
    }

    private function roomHasJoinablePeer(string $room): bool
    {
        foreach ($this->store->peersInRoom($room) as $row) {
            $owner = is_string($row->owner_user ?? null) ? $row->owner_user : '';
            if (str_starts_with($owner, 'u:')) {
                return true;
            }
            $name = is_string($row->name ?? null) ? trim($row->name) : '';
            if ($name !== '' && ! str_starts_with($name, self::KNOCK_NAME_PREFIX)) {
                return true;
            }
        }

        return false;
    }

    private function cleanRoom(mixed $room): string
    {
        if (! is_string($room) || ! preg_match('/^[A-Za-z0-9_-]{4,64}$/', $room)) {
            $this->fail('invalid_room');
        }

        return $room;
    }

    /**
     * Optional client token that identifies the browser profile (localStorage).
     * Invalid or missing values are ignored — join still succeeds, leftover
     * peers are just not evicted.
     *
     * @param  array<string, mixed>  $body
     * @return non-empty-string|null
     */
    private function readBrowserId(array $body): ?string
    {
        $raw = $body['browserId'] ?? null;
        if (! is_string($raw) || preg_match('/^[a-f0-9]{32}$/', $raw) !== 1) {
            return null;
        }

        return $raw;
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
            throw new MeetResponseException($exception->status, $exception->payload);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new MeetResponseException($status, $payload);
    }
}
