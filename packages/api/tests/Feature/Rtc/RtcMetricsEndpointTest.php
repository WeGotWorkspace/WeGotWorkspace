<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use Tests\Support\WgwDatabaseTestCase;

/**
 * The ingest endpoint exists so the contract and the client can land in this
 * wave; persisting the reports is issue #1096. Until then it validates and
 * accepts, which is what these tests pin.
 */
final class RtcMetricsEndpointTest extends WgwDatabaseTestCase
{
    public function test_a_well_formed_report_is_accepted(): void
    {
        $this->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'joinMs' => 820,
            'candidateType' => 'relay',
            'failedPairs' => 3,
            'iceRestarts' => 1,
            'httpFallback' => true,
            'pollRttMs' => 140,
            'net' => 'symmetric',
        ])->assertStatus(202);
    }

    public function test_a_minimal_report_is_accepted(): void
    {
        $this->postJson('/api/v1/rtc/metrics', ['channel' => 'collab'])->assertStatus(202);
    }

    public function test_a_report_without_a_channel_is_rejected(): void
    {
        $this->postJson('/api/v1/rtc/metrics', ['joinMs' => 820])->assertStatus(400);
    }

    public function test_values_outside_the_contract_are_rejected(): void
    {
        $this->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'candidateType' => 'teleport',
        ])->assertStatus(400);

        $this->postJson('/api/v1/rtc/metrics', [
            'channel' => 'principal',
        ])->assertStatus(400);

        $this->postJson('/api/v1/rtc/metrics', [
            'channel' => 'meet',
            'joinMs' => -1,
        ])->assertStatus(400);
    }

    public function test_reports_are_capped_at_thirty_a_minute_per_actor(): void
    {
        for ($request = 0; $request < 30; $request++) {
            $this->postJson('/api/v1/rtc/metrics', ['channel' => 'meet'])->assertStatus(202);
        }

        $this->postJson('/api/v1/rtc/metrics', ['channel' => 'meet'])->assertStatus(429);
    }
}
