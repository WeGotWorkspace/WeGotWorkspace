<?php

declare(strict_types=1);

namespace App\Services\Rtc\Signaling;

use App\Models\CollabMessage;
use App\Models\CollabPeer;
use App\Models\MeetMessage;
use App\Models\MeetPeer;
use App\Models\PrincipalMessage;
use App\Models\PrincipalPeer;
use Illuminate\Database\Eloquent\Model;

enum RtcSignalingPollMode
{
    /**
     * Return messages with id > since. Rows live until pruned, or — when the policy
     * sets `sinceAckCap` — until the cursor acks them.
     */
    case SinceCursor;

    /** Return undelivered messages and delete them after read. */
    case DeleteOnRead;
}

final readonly class RtcSignalingPolicy
{
    /**
     * @param  list<string>  $allowedSendTypes
     * @param  class-string<Model>  $peerModelClass
     * @param  class-string<Model>  $messageModelClass
     */
    public function __construct(
        public string $peersTable,
        public string $messagesTable,
        public string $peerModelClass,
        public string $messageModelClass,
        public int $peerTimeoutSeconds,
        public int $messageRetentionSeconds,
        public ?int $maxMessagesPerRoom,
        public RtcSignalingPollMode $pollMode,
        public array $allowedSendTypes,
        public string $peerIdPattern,
        public string $sendFromField,
        public bool $unknownPeerWhenMissing,
        public bool $leaveDeletesPeerMessages,
        public bool $trimMessagesOnSend,
        public bool $requireLivePeersOnSend,
        /** Expose the peer's owner username (`owner_user` minus the `u:` marker) as `user` in rosters. */
        public bool $rosterIncludesOwner = false,
        /** Persist the client `browserId` on the peer row. Meet also evicts same-browser leftovers on join. */
        public bool $persistBrowserId = false,
        /** Carry the join-computed `access` right on the peer row and in rosters (collab only). */
        public bool $rosterIncludesAccess = false,
        /**
         * Capability that gates {@see RtcSignalingPollMode::SinceCursor}. When set, `since`
         * is read as an ack: rows at or below it are deleted on poll, and a peer that does
         * not advertise the capability falls back to delete-on-read, so an old cached client
         * is not handed its whole mailbox on every poll. Null means the poll mode is
         * unconditional and no row is deleted on poll.
         */
        public ?string $sinceAckCap = null,
    ) {}

    /**
     * Meet mailboxes are acked, not drained: a client that advertises `since-ack`
     * polls with a cursor, so a lost response redelivers the offer, the chat line,
     * or the `admit` instead of dropping it. Clients without the capability keep
     * delete-on-read.
     */
    public static function meet(): self
    {
        return new self(
            peersTable: 'meet_peers',
            messagesTable: 'meet_messages',
            peerModelClass: MeetPeer::class,
            messageModelClass: MeetMessage::class,
            peerTimeoutSeconds: 60,
            messageRetentionSeconds: 600,
            maxMessagesPerRoom: null,
            pollMode: RtcSignalingPollMode::SinceCursor,
            allowedSendTypes: ['offer', 'answer', 'ice', 'bye'],
            peerIdPattern: '/^[A-Za-z0-9_-]{4,64}$/',
            sendFromField: 'from',
            unknownPeerWhenMissing: true,
            leaveDeletesPeerMessages: false,
            trimMessagesOnSend: false,
            requireLivePeersOnSend: false,
            persistBrowserId: true,
            sinceAckCap: RtcPeerCaps::SINCE_ACK,
        );
    }

    public static function collab(): self
    {
        return new self(
            peersTable: 'collab_peers',
            messagesTable: 'collab_messages',
            peerModelClass: CollabPeer::class,
            messageModelClass: CollabMessage::class,
            peerTimeoutSeconds: 90,
            messageRetentionSeconds: 600,
            maxMessagesPerRoom: 1000,
            pollMode: RtcSignalingPollMode::SinceCursor,
            allowedSendTypes: ['offer', 'answer', 'ice', 'yjs', 'yjs-sv'],
            peerIdPattern: '/^[a-f0-9]{16}$/',
            sendFromField: 'peerId',
            unknownPeerWhenMissing: true,
            leaveDeletesPeerMessages: true,
            trimMessagesOnSend: true,
            requireLivePeersOnSend: true,
            rosterIncludesOwner: true,
            persistBrowserId: true,
            rosterIncludesAccess: true,
        );
    }

    /**
     * Presence rooms for authenticated principals. SinceCursor like collab, but a
     * longer peer timeout: presence tabs poll slowly (15-30 s steady state) once the
     * data channels carry the presence/chat/typing traffic.
     */
    public static function principal(): self
    {
        return new self(
            peersTable: 'principal_peers',
            messagesTable: 'principal_messages',
            peerModelClass: PrincipalPeer::class,
            messageModelClass: PrincipalMessage::class,
            peerTimeoutSeconds: 90,
            messageRetentionSeconds: 600,
            maxMessagesPerRoom: 500,
            pollMode: RtcSignalingPollMode::SinceCursor,
            allowedSendTypes: ['offer', 'answer', 'ice'],
            peerIdPattern: '/^[A-Za-z0-9_-]{8,80}$/',
            sendFromField: 'peerId',
            unknownPeerWhenMissing: true,
            leaveDeletesPeerMessages: true,
            trimMessagesOnSend: true,
            requireLivePeersOnSend: true,
            rosterIncludesOwner: true,
        );
    }
}
