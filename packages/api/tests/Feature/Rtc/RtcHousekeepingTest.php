<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use App\Models\MeetPeer;
use App\Models\RtcRelayEvent;
use App\Models\RtcSessionMetric;
use App\Services\Rtc\RtcHousekeepingService;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\WgwDatabaseTestCase;

final class RtcHousekeepingTest extends WgwDatabaseTestCase
{
    public function test_the_sweep_drops_ghost_peers_and_expired_telemetry(): void
    {
        $now = time();
        $this->seedPeer('ghost-peer', $now - 120);
        $this->seedPeer('live-peer', $now - 5);
        RtcRelayEvent::query()->insert([
            ['created_at' => $now - RtcRelayEvent::RETENTION_SECONDS - 1, 'channel' => 'meet', 'actor' => 'bob', 'reason' => 'failed', 'outcome' => 'issued'],
            ['created_at' => $now - 60, 'channel' => 'meet', 'actor' => 'bob', 'reason' => 'failed', 'outcome' => 'issued'],
        ]);
        RtcSessionMetric::query()->insert([
            ['created_at' => $now - RtcSessionMetric::RETENTION_SECONDS - 1, 'channel' => 'meet'],
            ['created_at' => $now - 60, 'channel' => 'meet'],
        ]);

        $swept = (new RtcHousekeepingService)->sweep($now);

        $this->assertSame(1, $swept['peers']);
        $this->assertSame(1, $swept['relayEvents']);
        $this->assertSame(1, $swept['sessionMetrics']);
        $this->assertSame(['live-peer'], MeetPeer::query()->pluck('peer_id')->all());
        $this->assertSame(1, RtcRelayEvent::query()->count());
        $this->assertSame(1, RtcSessionMetric::query()->count());
    }

    public function test_the_scheduled_command_reports_what_it_removed(): void
    {
        $this->seedPeer('ghost-peer', time() - 120);

        $this->assertSame(0, Artisan::call('wgw:rtc:prune'));

        $this->assertStringContainsString('Pruned 1 stale signaling peer(s)', Artisan::output());
        $this->assertSame(0, MeetPeer::query()->count());
    }

    private function seedPeer(string $peerId, int $seenAt): void
    {
        MeetPeer::query()->insert([
            'room' => 'room-a',
            'peer_id' => $peerId,
            'name' => 'Peer',
            'owner_user' => 'u:bob',
            'seen_at' => $seenAt,
        ]);
    }
}
