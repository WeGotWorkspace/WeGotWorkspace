<?php

declare(strict_types=1);

namespace App\Services\Meet;

use App\Services\Rtc\RtcRelayService;
use App\Services\Rtc\RtcSettingsService;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcNetClass;
use App\Services\Rtc\Signaling\RtcPeerCaps;
use App\Services\Rtc\Signaling\RtcSignalingException;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Http\Request;

final class MeetSignalingService
{
    private const KNOCK_NAME_PREFIX = '__wgw_knock__:';

    /** Mirrors MeetChannelJoinPolicy::CONTROL_MESSAGE_PREFIX (knock / admit / deny). */
    private const CONTROL_TEXT_PREFIX = '__wgw_meet_control__:';

    /** Send types that set up a media session, so the lobby may not use them. */
    private const MEDIA_SEND_TYPES = ['offer', 'answer', 'ice'];

    private readonly HttpSignalingStore $store;

    public function __construct(
        private MeetActorResolver $actors,
        private RtcSettingsService $rtcSettingsService,
        private MeetReservationService $reservations,
        private MeetChannelJoinPolicy $channelJoinPolicy,
        private RtcRelayService $relays,
    ) {
        $this->store = new HttpSignalingStore(RtcSignalingPolicy::meet());
    }

    /**
     * ICE configuration for a room. Credentials are not part of it: an
     * unauthenticated caller used to get working relay credentials here, so
     * the endpoint now needs an account or a guest session and answers with a
     * plain `turnAvailable` flag.
     *
     * @param  array<string, mixed>  $body
     * @return array{stunUrls: string, turnAvailable: bool}
     */
    public function rtcSettings(Request $request, array $body = []): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->actors->requireActorMarker($request, $body);

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
            $room = $this->cleanRoom($body['room'] ?? null);
            $this->assertGuestMayEnter($this->actors->tryAuthenticatedUsername($request), $room);
            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);

            return $this->relays->issue(
                $this->store,
                'meet',
                $room,
                $ownerMarker,
                $body,
                $this->guestRelayDenied($room, $peerId, $ownerMarker),
            );
        });
    }

    /**
     * Guest relay rules (contract C3): an admitted guest in a channel room or
     * on a reserved code gets credentials, and on an unreserved ad-hoc code a
     * guest gets them only while an authenticated member is in the room. A
     * peer that is still knocking never does.
     */
    private function guestRelayDenied(string $room, string $peerId, string $ownerMarker): bool
    {
        if (str_starts_with($ownerMarker, 'u:')) {
            return false;
        }
        if (str_starts_with((string) $this->store->peerName($room, $peerId), self::KNOCK_NAME_PREFIX)) {
            return true;
        }

        $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
        if ($channel !== null || $this->reservations->find($room) !== null) {
            return ! $this->store->isPeerAdmitted($room, $peerId, $ownerMarker);
        }

        return ! $this->roomHasAuthenticatedPeer($room);
    }

    private function roomHasAuthenticatedPeer(string $room): bool
    {
        foreach ($this->store->peersInRoom($room) as $row) {
            if (str_starts_with(is_string($row->owner_user ?? null) ? $row->owner_user : '', 'u:')) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{active: bool}
     */
    public function roomStatus(array $body): array
    {
        return $this->run(function () use ($body): array {
            $this->store->pruneOldRowsSampled();
            $room = $this->cleanRoom($body['room'] ?? null);

            return ['active' => $this->roomHasJoinablePeer($room)];
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{peers: list<array{id: string, name: string}>, sessionKey: string|null, rtc: array{limits: array{maxPeers: int, maxVideoProfile: string, maxVideoProfileRelay: string}}}
     */
    public function join(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRowsSampled();

            $username = $this->actors->tryAuthenticatedUsername($request);
            $room = $this->cleanRoom($body['room'] ?? null);
            $this->assertGuestMayEnter($username, $room);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $name = mb_substr((string) ($body['name'] ?? ''), 0, 64);
            $isKnockRequest = str_starts_with($name, self::KNOCK_NAME_PREFIX);
            $guestSessionKey = null;
            $ownerMarker = $this->actors->ownerMarkerForAuthenticatedUser($username);

            $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
            // Ad-hoc Start writes a reservation and no channel. That code is
            // the guest door, so the lobby is enforced here too — not only
            // in the client.
            $reservedRoom = $channel === null ? $this->reservations->find($room) : null;
            if ($channel !== null) {
                // Channel-linked room: ACL members join directly (and are
                // hosts); authenticated non-members knock. Guests are refused
                // above, before a peer row exists.
                if ($ownerMarker === null) {
                    $guestSessionKey = $this->actors->readGuestSessionKey($body) ?? $this->actors->newGuestSessionKey();
                    $ownerMarker = $this->actors->ownerMarkerForGuestSession($guestSessionKey);
                }
                if ($username === null || ! $this->channelJoinPolicy->isChannelMember($username, $channel)) {
                    $this->assertNonMemberChannelJoin($room, $peerId, $ownerMarker, $isKnockRequest);
                }
            } elseif ($ownerMarker === null) {
                // Non-channel rooms: unknown leftovers stay room_not_active
                // when empty. A reserved ad-hoc code requires a knock the
                // same way a saved meeting does. An unreserved code has no
                // host who can admit, so a direct guest join still passes.
                $guestSessionKey = $this->actors->readGuestSessionKey($body) ?? $this->actors->newGuestSessionKey();
                $ownerMarker = $this->actors->ownerMarkerForGuestSession($guestSessionKey);
                if ($reservedRoom !== null) {
                    $this->assertNonMemberChannelJoin($room, $peerId, $ownerMarker, $isKnockRequest);
                } elseif ($isKnockRequest && ! $this->roomHasJoinablePeer($room) && ! $this->allowsEmptyGuestKnock($room)) {
                    $this->fail('room_not_active', 404);
                }
            }

            $browserId = $this->readBrowserId($body);
            $this->store->assertPeerIdFree($room, $peerId, $ownerMarker);
            $this->store->upsertPeer($room, $peerId, $name, $ownerMarker, time(), $browserId, [
                'caps' => RtcPeerCaps::encode($body['caps'] ?? null),
                'net' => RtcNetClass::normalize($body['net'] ?? null),
            ]);
            if ($browserId !== null) {
                $this->store->deletePeersForBrowser($room, $browserId, $peerId);
            }
            if ($isKnockRequest && ($channel !== null || $reservedRoom !== null)) {
                // A (re-)knock always starts unadmitted — otherwise a reused
                // peer id could inherit a stale admission.
                $this->store->clearPeerAdmission($room, $peerId);
            }
            if ($this->roomHasJoinablePeer($room)) {
                $this->reservations->markActivated($room, $username);
            }

            $maxPeers = $this->rtcSettingsService->meetMaxPeers();
            if ($this->store->countPeers($room) > $maxPeers) {
                $this->store->deletePeer($room, $peerId);
                $this->fail('room_full', 409);
            }

            return [
                'peers' => $this->store->peerList($room, $peerId, $username !== null),
                'sessionKey' => $guestSessionKey,
                'rtc' => ['limits' => [
                    'maxPeers' => $maxPeers,
                    ...$this->rtcSettingsService->videoLimits(),
                ]],
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

            $room = $this->cleanRoom($body['room'] ?? null);
            $username = $this->actors->tryAuthenticatedUsername($request);
            $this->assertGuestMayEnter($username, $room);
            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $peerId = $this->store->cleanPeer($body['peerId'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $peerId, $ownerMarker);

            $knownRosterSig = is_string($body['sig'] ?? null) ? (string) $body['sig'] : null;

            return $this->store->poll(
                $room,
                $peerId,
                max(0, (int) ($body['since'] ?? 0)),
                $knownRosterSig,
                $username !== null,
            );
        });
    }

    /**
     * @param  array<string, mixed>  $body
     * @return array{ok: true, peers: list<array<string, mixed>>, messages: list<array<string, mixed>>, rosterSig: string}
     */
    public function send(Request $request, array $body): array
    {
        return $this->run(function () use ($request, $body): array {
            $this->store->pruneOldRowsSampled();

            $room = $this->cleanRoom($body['room'] ?? null);
            $username = $this->actors->tryAuthenticatedUsername($request);
            $this->assertGuestMayEnter($username, $room);
            $ownerMarker = $this->actors->requireActorMarker($request, $body);
            $from = $this->store->readSendFrom($body);
            $to = $this->store->cleanPeer($body['to'] ?? null);
            $this->store->assertPeerOwnedByActor($room, $from, $ownerMarker);

            $type = (string) ($body['type'] ?? '');
            $this->assertNotWaitingInLobby($room, $from, $type);
            $this->store->send($room, $from, $to, $type, $body['payload'] ?? null);

            return ['ok' => true] + $this->store->pendingMailbox($room, $from, $username !== null);
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
            $this->store->pruneOldRowsSampled();

            $room = $this->cleanRoom($body['room'] ?? null);
            $this->assertGuestMayEnter($this->actors->tryAuthenticatedUsername($request), $room);
            $ownerMarker = $this->actors->requireActorMarker($request, $body);
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

            $this->assertKnockSenderSendsControlOnly($room, $from, $text);
            $this->recordChannelAdmission($request, $room, $text);

            $payload = json_encode(['text' => $text], JSON_THROW_ON_ERROR);
            if (strlen($payload) > 12_000) {
                $this->fail('payload_too_large', 413);
            }

            $targets = $this->chatTargets($room, $from, $text);

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
     * The lobby is not the call: a knock row may announce itself (and send
     * any other control payload that admittedPeerIdFromControlText and the
     * meet-control prefix already classify) but must not post a visible
     * room line. Same 403 family as media-from-lobby.
     */
    private function assertKnockSenderSendsControlOnly(string $room, string $from, string $text): void
    {
        if (! $this->isKnockPeer($room, $from)) {
            return;
        }
        if ($this->isControlChatText($text)) {
            return;
        }

        $this->fail('forbidden', 403, 'Waiting to be admitted — the call cannot be joined yet.');
    }

    /**
     * Control text is the meet-control family: the prefix that
     * admittedPeerIdFromControlText / lobbyDecisionPeerIdFromControlText
     * already require (knock announcement, admit, deny, and the rest).
     */
    private function isControlChatText(string $text): bool
    {
        return str_starts_with($text, self::CONTROL_TEXT_PREFIX)
            || $this->channelJoinPolicy->admittedPeerIdFromControlText($text) !== null
            || $this->channelJoinPolicy->lobbyDecisionPeerIdFromControlText($text) !== null;
    }

    /**
     * The lobby is not the call: a peer that is still knocking may not set up
     * media. Without this the waiting side could offer straight to a member,
     * whose browser answers, and be seen and heard before anyone admitted it.
     * Dropping the knock name on re-join is what opens the path again.
     */
    private function assertNotWaitingInLobby(string $room, string $peerId, string $type): void
    {
        if (! in_array($type, self::MEDIA_SEND_TYPES, true)) {
            return;
        }
        if (! $this->isKnockPeer($room, $peerId)) {
            return;
        }

        $this->fail('forbidden', 403, 'Waiting to be admitted — the call cannot be joined yet.');
    }

    /**
     * Chat fan-out leaves the lobby out, so room chat is unreadable while
     * someone waits. The decision that ends that wait (`admit` / `deny`) does
     * reach the knocker it names — that is how the waiting client learns.
     *
     * @return list<string>
     */
    private function chatTargets(string $room, string $from, string $text): array
    {
        $decidedPeerId = $this->channelJoinPolicy->lobbyDecisionPeerIdFromControlText($text);

        $targets = [];
        foreach ($this->store->peersInRoomExcept($room, $from) as $peer) {
            $isKnocking = str_starts_with($peer['name'], self::KNOCK_NAME_PREFIX);
            if (! $isKnocking || $peer['id'] === $decidedPeerId) {
                $targets[] = $peer['id'];
            }
        }

        return $targets;
    }

    private function isKnockPeer(string $room, string $peerId): bool
    {
        $name = $this->store->peerName($room, $peerId);

        return $name !== null && str_starts_with($name, self::KNOCK_NAME_PREFIX);
    }

    /**
     * Guests have no account. Named channels, team channels, direct messages,
     * and any room that is not an ad-hoc code are not guest doors — join,
     * knock, poll, and chat stop here so that chat cannot leak. An ad-hoc
     * meeting stays open on its room code.
     */
    private function assertGuestMayEnter(?string $username, string $room): void
    {
        if ($username !== null && $username !== '') {
            return;
        }
        if (! $this->channelJoinPolicy->isGuestClosedRoom($room)) {
            return;
        }

        $this->fail('forbidden', 403, 'Guests cannot join this conversation.');
    }

    /**
     * Non-member join on a channel room, and guest join on a reserved
     * ad-hoc code: knock joins on a known meeting invite may wait in an
     * empty room; other channel rooms still require someone joinable
     * (`room_not_active`). Non-knock joins pass only for a previously
     * admitted peer. Guests reach this method only on an ad-hoc meeting
     * room code; named channels and direct messages are refused first.
     */
    private function assertNonMemberChannelJoin(
        string $room,
        string $peerId,
        string $ownerMarker,
        bool $isKnockRequest,
    ): void {
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
     * Server-side half of knock admission: when a channel member, or the
     * manager of a reserved ad-hoc code (`createdBy` / owner-principal
     * member), broadcasts an `admit` control message, the target peer row
     * is marked admitted so its non-knock re-join passes the policy.
     * Non-member and guest senders are ignored (the message still delivers).
     */
    private function recordChannelAdmission(Request $request, string $room, string $text): void
    {
        $peerId = $this->channelJoinPolicy->admittedPeerIdFromControlText($text);
        if ($peerId === null) {
            return;
        }
        $username = $this->actors->tryAuthenticatedUsername($request);
        if ($username === null || $username === '') {
            return;
        }
        $channel = $this->channelJoinPolicy->resolveChannelForRoom($room);
        if ($channel !== null) {
            if (! $this->channelJoinPolicy->isChannelMember($username, $channel)) {
                return;
            }
            $this->store->markPeerAdmitted($room, $peerId);

            return;
        }
        $reservation = $this->reservations->find($room);
        if ($reservation === null || ! $this->reservations->canManage($username, $reservation)) {
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

    private function fail(string $error, int $status = 400, ?string $message = null): never
    {
        $payload = ['error' => $error];
        if ($message !== null) {
            $payload['message'] = $message;
        }
        throw new MeetResponseException($status, $payload);
    }
}
