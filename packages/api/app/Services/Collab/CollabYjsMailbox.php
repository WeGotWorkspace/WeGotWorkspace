<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcPeerAccess;
use App\Services\Rtc\Signaling\RtcSignalingException;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Contract C4: Yjs updates and state vectors on the collab mailbox.
 *
 * A `yjs` send may target `*` and is then one row per other peer. `yjs-sv`
 * stays peer-targeted. Readers may ask for state; they may not publish it.
 */
final class CollabYjsMailbox
{
    public const MAX_ENCODED_BYTES = 65_536;

    /** Sends per peer per second, on top of the room message cap. */
    public const SENDS_PER_SECOND = 10;

    public function deliver(
        HttpSignalingStore $store,
        string $room,
        string $from,
        mixed $toRaw,
        string $type,
        mixed $payload,
        string $access,
    ): void {
        if ($type === 'yjs' && $access === RtcPeerAccess::READ) {
            throw new RtcSignalingException(403, ['error' => 'forbidden']);
        }

        $this->assertPayload($payload);

        if ($toRaw === '*' && $type !== 'yjs') {
            throw new RtcSignalingException(400, ['error' => 'invalid_peer']);
        }

        $encoded = json_encode($payload);
        if ($encoded === false || strlen($encoded) > self::MAX_ENCODED_BYTES) {
            throw new RtcSignalingException(413, ['error' => 'payload_too_large']);
        }

        $key = 'collab-yjs:'.$room.':'.$from;
        if (RateLimiter::tooManyAttempts($key, self::SENDS_PER_SECOND)) {
            throw new RtcSignalingException(429, ['error' => 'rate_limited']);
        }
        RateLimiter::hit($key, 1);

        if ($toRaw === '*') {
            foreach ($store->peerList($room, $from) as $peer) {
                $store->send($room, $from, $peer['id'], $type, $payload);
            }

            return;
        }

        $store->send($room, $from, $store->cleanPeer($toRaw), $type, $payload);
    }

    private function assertPayload(mixed $payload): void
    {
        if (! is_array($payload)) {
            throw new RtcSignalingException(400, ['error' => 'invalid_payload']);
        }
        $update = $payload['u'] ?? null;
        $seq = $payload['n'] ?? null;
        if (! is_string($update) || $update === '' || ! is_int($seq) || $seq < 0) {
            throw new RtcSignalingException(400, ['error' => 'invalid_payload']);
        }
    }
}
