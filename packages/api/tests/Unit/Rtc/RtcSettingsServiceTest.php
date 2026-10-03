<?php

declare(strict_types=1);

namespace Tests\Unit\Rtc;

use App\Services\Rtc\RtcSettingsService;
use App\Services\Settings\SettingKeys;
use Tests\Support\WgwDatabaseTestCase;

final class RtcSettingsServiceTest extends WgwDatabaseTestCase
{
    public function test_public_settings_normalize_bare_stun_host(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => 'stun.example.com:3478',
            SettingKeys::RTC_TURN_URL => 'turn.example.com:3478?transport=udp',
            SettingKeys::RTC_TURN_SECRET => 'secret',
        ]);

        $settings = (new RtcSettingsService)->publicSettings();

        $this->assertSame(['stunUrls', 'turnAvailable'], array_keys($settings));
        $this->assertSame('stun:stun.example.com:3478', $settings['stunUrls']);
        $this->assertTrue($settings['turnAvailable']);
    }

    public function test_turn_urls_normalize_bare_hosts(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => "turn.example.com:3478?transport=udp\nturns:secure.example.com:5349",
        ]);

        $this->assertSame(
            ['turn:turn.example.com:3478?transport=udp', 'turns:secure.example.com:5349'],
            (new RtcSettingsService)->turnUrls(),
        );
    }

    public function test_turn_is_unavailable_without_secret_or_url(): void
    {
        $service = new RtcSettingsService;

        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.com',
            SettingKeys::RTC_TURN_SECRET => '',
        ]);
        $this->assertFalse($service->turnAvailable());

        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => '',
            SettingKeys::RTC_TURN_SECRET => 'secret',
        ]);
        $this->assertFalse($service->turnAvailable());
    }

    public function test_leftover_static_credentials_are_reported_until_a_secret_replaces_them(): void
    {
        $service = new RtcSettingsService;
        $this->setAppSettings([
            'rtc_turn_username' => 'legacy-user',
            'rtc_turn_credential' => 'legacy-pass',
        ]);

        $this->assertTrue($service->legacyStaticCredentialsPresent());

        $service->forgetLegacyStaticCredentials();

        $this->assertFalse($service->legacyStaticCredentialsPresent());
    }

    public function test_meet_max_peers_defaults_and_clamps(): void
    {
        $service = new RtcSettingsService;

        $this->setAppSettings([SettingKeys::MEET_MAX_PEERS => '']);
        $this->assertSame(4, $service->meetMaxPeers());

        $this->setAppSettings([SettingKeys::MEET_MAX_PEERS => '8']);
        $this->assertSame(8, $service->meetMaxPeers());

        $this->setAppSettings([SettingKeys::MEET_MAX_PEERS => '1']);
        $this->assertSame(2, $service->meetMaxPeers());

        $this->setAppSettings([SettingKeys::MEET_MAX_PEERS => '99']);
        $this->assertSame(15, $service->meetMaxPeers());
    }
}
