<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use App\Models\RtcRelayEvent;
use App\Models\RtcSessionMetric;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwRoleFixtures;

final class RtcRealtimeHealthTest extends WgwDatabaseTestCase
{
    use WgwRoleFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureRoleMatrix();
    }

    public function test_the_page_is_admin_only(): void
    {
        $this->getJson('/api/v1/admin/realtime-health')->assertStatus(401);
        $this->withBearer($this->userBearerToken())->getJson('/api/v1/admin/realtime-health')->assertStatus(403);
    }

    public function test_windows_split_join_time_relay_fallback_and_constrained_nets(): void
    {
        $now = time();
        foreach ([100, 200, 300, 400] as $index => $join) {
            RtcSessionMetric::query()->create([
                'created_at' => $now - 60,
                'channel' => $index === 0 ? 'collab' : 'meet',
                'join_ms' => $join,
                'candidate_type' => $index === 0 ? 'relay' : 'host',
                'failed_pairs' => $index === 1 ? 2 : 0,
                'ice_restarts' => 0,
                'http_fallback' => $index === 2,
                'poll_rtt_ms' => ($index + 1) * 10,
                'net' => $index === 3 ? 'symmetric' : 'open',
            ]);
        }
        RtcSessionMetric::query()->create([
            'created_at' => $now - (2 * 86400),
            'channel' => 'meet',
            'join_ms' => 9999,
            'candidate_type' => 'host',
            'failed_pairs' => 0,
            'ice_restarts' => 0,
            'http_fallback' => false,
            'poll_rtt_ms' => 1,
            'net' => 'udp-blocked',
        ]);

        $body = $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/realtime-health')
            ->assertOk()
            ->json();

        $this->assertSame(4, $body['day']['samples']);
        $this->assertSame(300, $body['day']['joinP50Ms']);
        $this->assertSame(400, $body['day']['joinP95Ms']);
        $this->assertEquals(25, $body['day']['relayPercent']);
        $this->assertEquals(25, $body['day']['failedPairsPercent']);
        $this->assertEquals(25, $body['day']['fallbackPercent']);
        $this->assertSame(40, $body['day']['pollP95Ms']);
        $this->assertEquals(25, $body['day']['constrainedPercent']);
        $this->assertSame(['meet' => 3, 'collab' => 1], $body['day']['byChannel']);

        $this->assertSame(5, $body['week']['samples']);
        $this->assertSame(300, $body['week']['joinP50Ms']);
        $this->assertSame(9999, $body['week']['joinP95Ms']);
        $this->assertSame(30, $body['retentionDays']);
        $this->assertNull($body['callout']);
    }

    public function test_unavailable_relay_outcomes_call_out_when_turn_is_not_configured(): void
    {
        $now = time();
        RtcRelayEvent::query()->insert([
            [
                'created_at' => $now - 30,
                'channel' => 'meet',
                'actor' => 'bob',
                'reason' => 'failed',
                'outcome' => 'unavailable',
            ],
            [
                'created_at' => $now - 20,
                'channel' => 'collab',
                'actor' => 'bob',
                'reason' => 'timeout',
                'outcome' => 'unavailable',
            ],
            [
                'created_at' => $now - 10,
                'channel' => 'meet',
                'actor' => 'carol',
                'reason' => 'failed',
                'outcome' => 'issued',
            ],
        ]);

        $body = $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/realtime-health')
            ->assertOk()
            ->json();

        $this->assertFalse($body['turnConfigured']);
        $this->assertSame(1, $body['unavailablePeopleThisWeek']);
        $this->assertSame(
            "1 people couldn't connect directly this week. Set up TURN.",
            $body['callout'],
        );
        $today = array_values(array_filter(
            $body['relayDays'],
            static fn (array $day): bool => $day['unavailable'] > 0 || $day['issued'] > 0,
        ));
        $this->assertCount(1, $today);
        $this->assertSame(2, $today[0]['unavailable']);
        $this->assertSame(1, $today[0]['issued']);
        $this->assertSame(0, $today[0]['denied']);
        $this->assertStringNotContainsString('symmetric', (string) json_encode($body));
        $this->assertStringNotContainsString('203.0.113.', (string) json_encode($body));
    }

    public function test_a_refresh_does_not_count_as_could_not_connect(): void
    {
        $now = time();
        RtcRelayEvent::query()->create([
            'created_at' => $now - 10,
            'channel' => 'meet',
            'actor' => 'bob',
            'reason' => 'refresh',
            'outcome' => 'unavailable',
        ]);

        $body = $this->withBearer($this->adminBearerToken())
            ->getJson('/api/v1/admin/realtime-health')
            ->assertOk()
            ->json();

        $this->assertSame(0, $body['unavailablePeopleThisWeek']);
        $this->assertNull($body['callout']);
        $issued = array_sum(array_column($body['relayDays'], 'unavailable'));
        $this->assertSame(0, $issued);
    }
}
