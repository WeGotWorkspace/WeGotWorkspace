<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\TrafficBudget;
use Tests\TestCase;

final class TrafficBudgetTest extends TestCase
{
    public function test_shared_profile_is_the_default(): void
    {
        config(['wgw.traffic' => ['profile' => 'shared']]);

        $this->assertSame('background=30; bulk=20; burst=10', TrafficBudget::header());
    }

    public function test_standard_profile_is_roomier(): void
    {
        config(['wgw.traffic' => ['profile' => 'standard']]);

        $this->assertSame(['background' => 120, 'bulk' => 120, 'burst' => 30], TrafficBudget::current());
    }

    public function test_a_number_overrides_its_profile_and_junk_falls_back(): void
    {
        config(['wgw.traffic' => [
            'profile' => 'shared',
            'background_per_minute' => '45',
            'bulk_per_minute' => 'lots',
            'burst' => '-3',
        ]]);

        $this->assertSame(['background' => 45, 'bulk' => 20, 'burst' => 0], TrafficBudget::current());
    }

    public function test_an_unknown_profile_takes_the_strict_one(): void
    {
        config(['wgw.traffic' => ['profile' => 'turbo']]);

        $this->assertSame(30, TrafficBudget::current()['background']);
    }

    public function test_off_profile_announces_zero_everywhere(): void
    {
        config(['wgw.traffic' => ['profile' => 'off']]);

        $this->assertSame('background=0; bulk=0; burst=0', TrafficBudget::header());
    }

    public function test_numbers_are_clamped_to_the_range(): void
    {
        config(['wgw.traffic' => ['profile' => 'shared', 'background_per_minute' => '999999', 'burst' => '0']]);

        $this->assertSame(['background' => 10000, 'bulk' => 20, 'burst' => 0], TrafficBudget::current());
    }

    public function test_the_profile_name_ignores_case_and_spaces(): void
    {
        config(['wgw.traffic' => ['profile' => ' Standard ']]);

        $this->assertSame(120, TrafficBudget::current()['background']);
    }

    public function test_api_answers_carry_the_budget_header(): void
    {
        config(['wgw.traffic' => ['profile' => 'shared']]);

        $this->getJson('/api/v1/health')->assertHeader(TrafficBudget::HEADER, 'background=30; bulk=20; burst=10');
    }
}
