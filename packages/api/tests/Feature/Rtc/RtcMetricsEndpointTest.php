<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use App\Models\MeetPeer;
use App\Models\RtcSessionMetric;
use App\Services\Meet\MeetActorResolver;
use Illuminate\Support\Facades\Cache;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwRoleFixtures;

final class RtcMetricsEndpointTest extends WgwDatabaseTestCase
{
    use WgwRoleFixtures;

    private const GUEST_SESSION = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        $this->configureRoleMatrix();
    }

    public function test_a_signed_in_report_is_stored_without_room_or_address(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'joinMs' => 820,
            'candidateType' => 'relay',
            'failedPairs' => 3,
            'iceRestarts' => 1,
            'httpFallback' => true,
            'pollRttMs' => 140,
            'net' => 'symmetric',
            'room' => 'room-secret-name',
            'ip' => '203.0.113.10',
            'sdp' => 'v=0-leak',
            'ticket' => 'ticket-leak',
            'sessionKey' => self::GUEST_SESSION,
        ])->assertStatus(202);

        $row = RtcSessionMetric::query()->sole();
        $this->assertSame('meet', $row->channel);
        $this->assertSame(820, (int) $row->join_ms);
        $this->assertSame('relay', $row->candidate_type);
        $this->assertSame(3, (int) $row->failed_pairs);
        $this->assertSame(1, (int) $row->ice_restarts);
        $this->assertTrue($row->http_fallback);
        $this->assertSame(140, (int) $row->poll_rtt_ms);
        $this->assertSame('symmetric', $row->net);
        $this->assertGreaterThan(time() - 30, (int) $row->created_at);

        $stored = (string) json_encode($row->getAttributes());
        $this->assertStringNotContainsString('room-secret-name', $stored);
        $this->assertStringNotContainsString('203.0.113.10', $stored);
        $this->assertStringNotContainsString('v=0-leak', $stored);
        $this->assertStringNotContainsString('ticket-leak', $stored);
        $this->assertStringNotContainsString(self::GUEST_SESSION, $stored);
        $this->assertStringNotContainsString('bob', $stored);
    }

    public function test_a_live_guest_session_can_report(): void
    {
        $sessionKey = app(MeetActorResolver::class)->newGuestSessionKey();
        MeetPeer::query()->insert([
            'room' => 'room-a',
            'peer_id' => 'guest-peer',
            'name' => 'Guest',
            'owner_user' => 'g:'.$sessionKey,
            'seen_at' => time(),
        ]);

        $this->postJson('/api/v1/rtc/metrics?sessionKey='.$sessionKey, [
            'channel' => 'collab',
        ])->assertStatus(202);

        $row = RtcSessionMetric::query()->sole();
        $this->assertSame('collab', $row->channel);
        $this->assertSame(0, (int) $row->join_ms);
        $this->assertStringNotContainsString($sessionKey, (string) json_encode($row->getAttributes()));
    }

    public function test_a_minted_session_key_is_rejected_and_stores_nothing(): void
    {
        $this->postJson('/api/v1/rtc/metrics?sessionKey=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [
            'channel' => 'meet',
        ])->assertStatus(401);

        $this->assertSame(0, RtcSessionMetric::query()->count());
    }

    public function test_an_anonymous_report_is_rejected(): void
    {
        $this->postJson('/api/v1/rtc/metrics', ['channel' => 'meet'])->assertStatus(401);
        $this->assertSame(0, RtcSessionMetric::query()->count());
    }

    public function test_a_report_without_a_channel_is_rejected(): void
    {
        $this->withBearer($this->userBearerToken())
            ->postJson('/api/v1/rtc/metrics', ['joinMs' => 820])
            ->assertStatus(400);
        $this->assertSame(0, RtcSessionMetric::query()->count());
    }

    public function test_values_outside_the_contract_are_rejected(): void
    {
        $token = $this->userBearerToken();
        $this->withBearer($token)->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'candidateType' => 'teleport',
        ])->assertStatus(400);

        $this->withBearer($token)->postJson('/api/v1/rtc/metrics', [
            'channel' => 'principal',
        ])->assertStatus(400);

        $this->withBearer($token)->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'joinMs' => -1,
        ])->assertStatus(400);

        $this->assertSame(0, RtcSessionMetric::query()->count());
    }

    public function test_a_batch_over_eight_kibibytes_is_rejected(): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'pad' => str_repeat('a', 9000),
        ])->assertStatus(400);

        $this->assertSame(0, RtcSessionMetric::query()->count());
    }

    public function test_minted_keys_cannot_multiply_the_address_budget(): void
    {
        Cache::flush();
        for ($request = 0; $request < 30; $request++) {
            $key = str_pad(dechex($request), 32, 'c');
            $this->postJson('/api/v1/rtc/metrics?sessionKey='.$key, [
                'channel' => 'meet',
            ])->assertStatus(401);
        }

        $this->postJson('/api/v1/rtc/metrics?sessionKey=dddddddddddddddddddddddddddddddd', [
            'channel' => 'meet',
        ])->assertStatus(429);
        $this->assertSame(0, RtcSessionMetric::query()->count());
    }

    public function test_reports_are_capped_at_thirty_a_minute_per_actor(): void
    {
        Cache::flush();
        $token = $this->userBearerToken();
        for ($request = 0; $request < 30; $request++) {
            $this->withBearer($token)->postJson('/api/v1/rtc/metrics', ['channel' => 'meet'])->assertStatus(202);
        }

        $this->withBearer($token)->postJson('/api/v1/rtc/metrics', ['channel' => 'meet'])->assertStatus(429);
        $this->assertSame(30, RtcSessionMetric::query()->count());
    }
}
