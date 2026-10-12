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

        $this->assertSame(['stunUrls', 'turnAvailable', 'forceRelay', 'debug'], array_keys($settings));
        $this->assertSame('stun:stun.example.com:3478', $settings['stunUrls']);
        $this->assertTrue($settings['turnAvailable']);
        $this->assertFalse($settings['forceRelay']);
        $this->assertFalse($settings['debug']);
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

    public function test_a_sealed_turn_secret_round_trips_and_a_legacy_row_still_reads(): void
    {
        $service = new RtcSettingsService;
        $sealed = $service->sealTurnSecret('north');

        $this->assertNotSame('north', $sealed);
        $this->setAppSettings([SettingKeys::RTC_TURN_SECRET => $sealed]);
        $this->assertSame('north', $service->turnSecret());

        $this->setAppSettings([SettingKeys::RTC_TURN_SECRET => 'legacy-plain']);
        $this->assertSame('legacy-plain', $service->turnSecret());
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

    public function test_max_video_profile_defaults_and_rejects_unknown_values(): void
    {
        $service = new RtcSettingsService;

        $this->setAppSettings([SettingKeys::MEET_MAX_VIDEO_PROFILE => '']);
        $this->assertSame('p720', $service->maxVideoProfile());

        $this->setAppSettings([SettingKeys::MEET_MAX_VIDEO_PROFILE => 'p270']);
        $this->assertSame('p270', $service->maxVideoProfile());

        $this->setAppSettings([SettingKeys::MEET_MAX_VIDEO_PROFILE => 'p1080']);
        $this->assertSame('p720', $service->maxVideoProfile());

        $this->setAppSettings([SettingKeys::MEET_MAX_VIDEO_PROFILE => 'audio']);
        $this->assertSame('audio', $service->maxVideoProfile());
    }

    public function test_relay_video_profile_defaults_and_never_exceeds_the_instance_maximum(): void
    {
        $service = new RtcSettingsService;

        $this->setAppSettings([
            SettingKeys::MEET_MAX_VIDEO_PROFILE => '',
            SettingKeys::MEET_MAX_VIDEO_PROFILE_RELAY => '',
        ]);
        $this->assertSame('p360', $service->maxVideoProfileRelay());

        $this->setAppSettings([
            SettingKeys::MEET_MAX_VIDEO_PROFILE => 'p720',
            SettingKeys::MEET_MAX_VIDEO_PROFILE_RELAY => 'p180',
        ]);
        $this->assertSame('p180', $service->maxVideoProfileRelay());

        // A relay ceiling above the instance maximum is pulled back down to it.
        $this->setAppSettings([
            SettingKeys::MEET_MAX_VIDEO_PROFILE => 'p270',
            SettingKeys::MEET_MAX_VIDEO_PROFILE_RELAY => 'p720',
        ]);
        $this->assertSame('p270', $service->maxVideoProfileRelay());

        $this->setAppSettings([
            SettingKeys::MEET_MAX_VIDEO_PROFILE => 'audio',
            SettingKeys::MEET_MAX_VIDEO_PROFILE_RELAY => 'p360',
        ]);
        $this->assertSame('audio', $service->maxVideoProfileRelay());
    }
}
