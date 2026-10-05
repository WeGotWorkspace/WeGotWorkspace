<?php

declare(strict_types=1);

namespace Tests\Unit\Rtc;

use App\Services\Rtc\RtcSettingsService;
use App\Services\Rtc\RtcTurnCredentialService;
use App\Services\Settings\SettingKeys;
use Tests\Support\WgwDatabaseTestCase;

final class RtcTurnCredentialServiceTest extends WgwDatabaseTestCase
{
    /**
     * Known vector from the TURN REST API convention coturn implements with
     * `use-auth-secret`: username `1266890800:mbzrxpgjys`, shared secret
     * `north`. The expected string was produced independently with
     * `openssl dgst -sha1 -hmac north | base64`, so this pins the wire format
     * and not just our own arithmetic.
     */
    public function test_credential_matches_the_coturn_known_vector(): void
    {
        $this->assertSame(
            'nbRcrnq5h6xXhyNhlwk+lDLvVVo=',
            RtcTurnCredentialService::credential('1266890800:mbzrxpgjys', 'north'),
        );
    }

    public function test_username_is_the_expiry_and_a_hashed_actor(): void
    {
        $username = RtcTurnCredentialService::username('u:alice', 1234567890);

        [$expiry, $marker] = explode(':', $username, 2);
        $this->assertSame('1234567890', $expiry);
        $this->assertSame(substr(sha1('u:alice'), 0, 16), $marker);
        $this->assertMatchesRegularExpression('/^[0-9]+:[0-9a-f]{16}$/', $username);
        $this->assertStringNotContainsString('alice', $username);
    }

    public function test_mint_returns_urls_hmac_credential_and_one_hour_ttl(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => "turn:relay.example.org:3478\nturns:relay.example.org:5349",
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);
        $now = 1_700_000_000;

        $turn = (new RtcTurnCredentialService(new RtcSettingsService))->mint('u:alice', $now);

        $this->assertNotNull($turn);
        $this->assertSame(['turn:relay.example.org:3478', 'turns:relay.example.org:5349'], $turn['urls']);
        $this->assertSame(3600, $turn['ttl']);
        $this->assertSame(RtcTurnCredentialService::username('u:alice', $now + 3600), $turn['username']);
        $this->assertSame(
            RtcTurnCredentialService::credential($turn['username'], 'north'),
            $turn['credential'],
        );
    }

    public function test_two_actors_never_share_a_credential(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org',
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);
        $service = new RtcTurnCredentialService(new RtcSettingsService);

        $alice = $service->mint('u:alice', 1_700_000_000);
        $guest = $service->mint('g:'.str_repeat('a', 32), 1_700_000_000);

        $this->assertNotNull($alice);
        $this->assertNotNull($guest);
        $this->assertNotSame($alice['username'], $guest['username']);
        $this->assertNotSame($alice['credential'], $guest['credential']);
    }

    public function test_mint_returns_nothing_without_a_secret_or_url(): void
    {
        $service = new RtcTurnCredentialService(new RtcSettingsService);

        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org',
            SettingKeys::RTC_TURN_SECRET => '',
        ]);
        $this->assertNull($service->mint('u:alice'));
        $this->assertFalse($service->available());

        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => '',
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);
        $this->assertNull($service->mint('u:alice'));
        $this->assertFalse($service->available());
    }
}
