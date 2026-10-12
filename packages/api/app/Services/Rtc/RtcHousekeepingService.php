<?php

declare(strict_types=1);

namespace App\Services\Rtc;

use App\Models\RtcRelayEvent;
use App\Models\RtcSessionMetric;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;

/**
 * Scheduled sweep for the signaling tables. Request-time pruning is sampled,
 * so a room that goes quiet keeps its last ghosts until this runs; the two
 * telemetry tables are only ever pruned here, on their 30-day retention.
 */
final class RtcHousekeepingService
{
    /**
     * @return array{peers: int, relayEvents: int, sessionMetrics: int}
     */
    public function sweep(?int $now = null): array
    {
        $now ??= time();
        $peers = 0;
        foreach ([RtcSignalingPolicy::meet(), RtcSignalingPolicy::collab(), RtcSignalingPolicy::principal()] as $policy) {
            $store = new HttpSignalingStore($policy);
            $peers += $store->countStalePeers($now);
            $store->pruneOldRows();
        }

        return [
            'peers' => $peers,
            'relayEvents' => RtcRelayEvent::query()
                ->where('created_at', '<', $now - RtcRelayEvent::RETENTION_SECONDS)
                ->delete(),
            'sessionMetrics' => RtcSessionMetric::query()
                ->where('created_at', '<', $now - RtcSessionMetric::RETENTION_SECONDS)
                ->delete(),
        ];
    }
}
