<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Models\RtcRelayEvent;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcNetClass;
use App\Services\Rtc\Signaling\RtcSignalingException;

/**
 * Just-in-time relay credentials (contract C11). A peer asks for them only
 * when it needs them — a network precheck, a connection timeout, or a failed
 * connection — so the relay is never advertised to the whole internet the way
 * static credentials on the configuration endpoint were.
 *
 * Every request leaves exactly one `rtc_relay_events` row, including the
 * refusals, because "who could not connect" is the question the real-time
 * health page exists to answer.
 */
final class RtcRelayService
{
    /** @var list<string> */
    public const REASONS = ['precheck', 'timeout', 'failed'];

    public const OUTCOME_ISSUED = 'issued';

    public const OUTCOME_UNAVAILABLE = 'unavailable';

    public const OUTCOME_DENIED = 'denied';

    /** Wildcard target for a precheck, which has no peer to hint yet. */
    private const ANY_TARGET = '*';

    public function __construct(private RtcTurnCredentialService $credentials) {}

    /**
     * @param  array<string, mixed>  $body
     * @return array{turn: array{urls: list<string>, username: string, credential: string, ttl: int}}
     */
    public function issue(
        HttpSignalingStore $store,
        string $channel,
        string $room,
        string $actorMarker,
        array $body,
        bool $guestDenied = false,
    ): array {
        $peerId = $store->cleanPeer($body['peerId'] ?? null);
        $store->assertPeerOwnedByActor($room, $peerId, $actorMarker);

        $reason = is_string($body['reason'] ?? null) ? $body['reason'] : '';
        if (! in_array($reason, self::REASONS, true)) {
            throw new RtcSignalingException(400, ['error' => 'invalid_reason']);
        }

        $target = $this->readTarget($store, $room, $body, $reason);
        $actor = self::actorLabel($actorMarker);

        if ($guestDenied) {
            $this->record($channel, $actor, $reason, self::OUTCOME_DENIED);
            throw new RtcSignalingException(403, [
                'error' => 'relay_denied',
                'message' => 'Ask the host to let you in before using the relay.',
            ]);
        }

        $turn = $this->credentials->mint($actorMarker);
        if ($turn === null) {
            $this->record($channel, $actor, $reason, self::OUTCOME_UNAVAILABLE);
            throw new RtcSignalingException(503, ['error' => 'relay_unavailable']);
        }

        $this->record($channel, $actor, $reason, self::OUTCOME_ISSUED);
        $store->rememberNetClass($room, $peerId, RtcNetClass::normalize($body['net'] ?? null));
        if ($target !== self::ANY_TARGET) {
            // The other side has to turn on its own relay, or the pair still
            // has no common path.
            $store->insertServerMessage($room, $peerId, $target, 'relay-hint', ['reason' => $reason]);
        }

        return ['turn' => $turn];
    }

    /** Username for authenticated actors, the literal `guest` for everyone else. */
    public static function actorLabel(string $actorMarker): string
    {
        return str_starts_with($actorMarker, 'u:') ? substr($actorMarker, 2) : 'guest';
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function readTarget(HttpSignalingStore $store, string $room, array $body, string $reason): string
    {
        $raw = $body['target'] ?? null;
        if ($reason === 'precheck' && $raw === self::ANY_TARGET) {
            return self::ANY_TARGET;
        }

        $target = $store->cleanPeer($raw);
        if (! $store->peerExists($room, $target)) {
            throw new RtcSignalingException(404, ['error' => 'unknown_peer']);
        }

        return $target;
    }

    private function record(string $channel, string $actor, string $reason, string $outcome): void
    {
        RtcRelayEvent::query()->create([
            'created_at' => time(),
            'channel' => $channel,
            'actor' => $actor,
            'reason' => $reason,
            'outcome' => $outcome,
        ]);
    }
}
