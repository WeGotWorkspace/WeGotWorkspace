<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Services\Settings\SettingKeys;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminRtcDiagnosticsTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_admin_saves_and_reads_rtc_diagnostics(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)->putJson('/api/v1/admin/settings', [
            'values' => [
                SettingKeys::RTC_DEBUG_LOGGING => true,
                SettingKeys::RTC_FORCE_RELAY => true,
            ],
        ])->assertOk();

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.debugLogging', true)
            ->assertJsonPath('rtc.forceRelay', true);

        $this->withBearer($token)->putJson('/api/v1/admin/settings', [
            'values' => [
                SettingKeys::RTC_DEBUG_LOGGING => 'false',
                SettingKeys::RTC_FORCE_RELAY => 'false',
            ],
        ])->assertOk();

        $this->withBearer($token)->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.debugLogging', false)
            ->assertJsonPath('rtc.forceRelay', false);
    }
}
