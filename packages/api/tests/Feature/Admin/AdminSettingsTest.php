<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Services\Settings\SettingKeys;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminSettingsTest extends WgwDatabaseTestCase
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

    public function test_mail_kill_switch_persists_in_admin_state(): void
    {
        $token = $this->adminBearerToken();

        $response = $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_ENABLED => false,
                ],
            ]);
        $response->assertOk()->assertJsonPath('ok', true);
        $saved = $response->json('saved');
        $this->assertContains(SettingKeys::MAIL_ENABLED, $saved);

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mail.enabled', false);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MAIL_ENABLED => true,
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mail.enabled', true);
    }

    public function test_rtc_settings_persist_in_admin_state(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::RTC_STUN_URL => 'stun:stun.example.test:3478,stuns:stun-backup.example.test:5349',
                    SettingKeys::RTC_TURN_URL => 'turn:turn.example.test:3478?transport=udp',
                    SettingKeys::RTC_TURN_USERNAME => 'rtc-user',
                    SettingKeys::RTC_TURN_CREDENTIAL => 'rtc-secret',
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('rtc.turnUsername', 'rtc-user')
            ->assertJsonPath('rtc.turnPassword', 'rtc-secret')
            ->assertJsonPath('rtc.stunUrls', 'stun:stun.example.test:3478, stuns:stun-backup.example.test:5349')
            ->assertJsonPath('rtc.turnUrls', 'turn:turn.example.test:3478?transport=udp');
    }

    public function test_webdav_and_app_toggles_persist_in_admin_state(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::BROWSER_PLUGIN => false,
                    SettingKeys::CALENDAR_ENABLED => false,
                    SettingKeys::CONTACTS_ENABLED => true,
                    SettingKeys::TIMEZONE => 'Europe/Amsterdam',
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('webdav.sabreUi', false)
            ->assertJsonPath('webdav.timezone', 'Europe/Amsterdam')
            ->assertJsonPath('apps.calendars', false)
            ->assertJsonPath('apps.contacts', true);
    }

    public function test_mcp_kill_switch_persists_in_admin_state(): void
    {
        $token = $this->adminBearerToken();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mcp.enabled', false);

        $this->withBearer($token)
            ->putJson('/api/v1/admin/settings', [
                'values' => [
                    SettingKeys::MCP_ENABLED => true,
                ],
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson('/api/v1/admin/state')
            ->assertOk()
            ->assertJsonPath('mcp.enabled', true);
    }
}
