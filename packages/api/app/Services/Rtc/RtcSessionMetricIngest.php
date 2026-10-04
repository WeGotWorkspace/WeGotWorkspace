<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Models\CollabPeer;
use App\Models\MeetPeer;
use App\Models\PrincipalPeer;
use App\Models\RtcSessionMetric;
use App\Services\Meet\MeetActorResolver;
use App\Services\Rtc\Signaling\RtcNetClass;
use Illuminate\Http\Request;

/**
 * One anonymous sample for the real-time health page.
 *
 * The stored row is the allow-list in {@see store()}. Addresses, room names,
 * tickets, SDP, and user ids are never written, even when the caller sends them.
 */
final class RtcSessionMetricIngest
{
    public const MAX_BODY_BYTES = 8192;

    /** @var list<string> */
    private const CANDIDATE_TYPES = ['host', 'srflx', 'prflx', 'relay'];

    public function __construct(private MeetActorResolver $actors) {}

    public function bodyWithinLimit(Request $request): bool
    {
        $declared = $request->header('Content-Length');
        if (is_string($declared) && ctype_digit($declared) && (int) $declared > self::MAX_BODY_BYTES) {
            return false;
        }

        return strlen($request->getContent()) <= self::MAX_BODY_BYTES;
    }

    /**
     * A signed-in account, or a guest session that still has a live peer row.
     * A caller-minted session key that never joined is not a session.
     */
    public function actorMayReport(Request $request): bool
    {
        if ($this->actors->tryAuthenticatedUsername($request) !== null) {
            return true;
        }

        $sessionKey = $this->guestSessionKey($request);
        if ($sessionKey === null) {
            return false;
        }

        $owner = 'g:'.$sessionKey;
        foreach ([MeetPeer::class, CollabPeer::class, PrincipalPeer::class] as $model) {
            if ($model::query()->where('owner_user', $owner)->exists()) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    public function store(array $validated): void
    {
        RtcSessionMetric::query()->create([
            'created_at' => time(),
            'channel' => $validated['channel'],
            'join_ms' => $this->intField($validated, 'joinMs'),
            'candidate_type' => $this->candidateType($validated['candidateType'] ?? null),
            'failed_pairs' => $this->intField($validated, 'failedPairs'),
            'ice_restarts' => $this->intField($validated, 'iceRestarts'),
            'http_fallback' => (bool) ($validated['httpFallback'] ?? false),
            'poll_rtt_ms' => $this->intField($validated, 'pollRttMs'),
            'net' => RtcNetClass::normalize($validated['net'] ?? null),
        ]);
    }

    private function guestSessionKey(Request $request): ?string
    {
        foreach ([$request->query('sessionKey'), $request->input('sessionKey')] as $raw) {
            if (is_string($raw) && preg_match('/^[a-f0-9]{32}$/', $raw) === 1) {
                return $raw;
            }
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $validated
     */
    private function intField(array $validated, string $key): int
    {
        $value = $validated[$key] ?? 0;

        return is_numeric($value) ? max(0, (int) $value) : 0;
    }

    private function candidateType(mixed $value): string
    {
        return is_string($value) && in_array($value, self::CANDIDATE_TYPES, true) ? $value : '';
    }
}
