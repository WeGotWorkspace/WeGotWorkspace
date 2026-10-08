<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Services\Settings\SettingKeys;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetRtcConfigurationTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_rtc_settings_endpoint_exposes_stun_urls_and_relay_flag(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => "one.example.org:3478, \nstun:two.example.org",
            SettingKeys::RTC_TURN_URL => "turn:one.example.org\nturn-two.example.org:3478?transport=udp",
            SettingKeys::RTC_TURN_SECRET => 'relay-secret',
        ]);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson($this->meetRoomPath('/configuration'));

        $response->assertOk();
        $response->assertJson([
            'rtc' => [
                'stunUrls' => 'stun:one.example.org:3478, stun:two.example.org',
                'turnAvailable' => true,
            ],
        ]);
    }

    public function test_rtc_configuration_never_returns_relay_credentials(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => 'stun.public.test:3478',
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org',
            SettingKeys::RTC_TURN_SECRET => 'relay-secret',
        ]);

        $response = $this->withBearer($this->userBearerToken())
            ->getJson($this->meetRoomPath('/configuration'));

        $response->assertOk();
        $rtc = $response->json('rtc');
        $this->assertIsArray($rtc);
        $this->assertSame(['stunUrls', 'turnAvailable'], array_keys($rtc));
        $this->assertStringNotContainsString('relay-secret', $response->getContent() ?: '');
    }

    public function test_anonymous_rtc_configuration_is_unauthorized(): void
    {
        $this->setAppSettings([SettingKeys::RTC_STUN_URL => 'stun.public.test:3478']);

        $this->withoutBearer()
            ->getJson($this->meetRoomPath('/configuration'))
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }

    public function test_guest_session_key_reads_rtc_configuration(): void
    {
        $this->setAppSettings([SettingKeys::RTC_STUN_URL => 'stun.public.test:3478']);
        $guest = $this->guestJoin('guest-peer', 'Guest');

        $this->withoutBearer()
            ->getJson($this->meetRoomPath('/configuration').'?sessionKey='.$guest['sessionKey'])
            ->assertOk()
            ->assertJsonPath('rtc.stunUrls', 'stun:stun.public.test:3478')
            ->assertJsonPath('rtc.turnAvailable', false);
    }

    public function test_relay_is_unavailable_without_a_secret(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => '',
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org',
            SettingKeys::RTC_TURN_SECRET => '',
        ]);

        $this->withBearer($this->userBearerToken())
            ->getJson($this->meetRoomPath('/configuration'))
            ->assertOk()
            ->assertJsonPath('rtc.stunUrls', '')
            ->assertJsonPath('rtc.turnAvailable', false);
    }
}
