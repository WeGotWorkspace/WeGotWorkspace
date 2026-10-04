<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Models\Notification;
use App\Models\RtcRelayEvent;
use App\Services\Rtc\RtcTurnCredentialService;
use App\Services\Settings\SettingKeys;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetRelayTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const KNOCK_PREFIX = '__wgw_knock__:';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_member_gets_short_lived_credentials_and_the_target_gets_a_hint(): void
    {
        $this->configureRelay();
        $token = $this->userBearerToken();
        $this->joinAsMember('host-peer', $token);
        $guest = $this->withoutBearer()->guestJoin('guest-peer', 'Guest');

        $response = $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'host-peer',
            'target' => 'guest-peer',
            'reason' => 'failed',
            'net' => 'symmetric',
        ]);

        $response->assertOk();
        $this->assertSame(['turn:relay.example.org:3478'], $response->json('turn.urls'));
        $this->assertSame(600, $response->json('turn.ttl'));
        $this->assertSame(
            RtcTurnCredentialService::credential((string) $response->json('turn.username'), 'north'),
            $response->json('turn.credential'),
        );

        $hints = $this->pollGuest($guest['sessionKey']);
        $this->assertCount(1, $hints);
        $this->assertSame('relay-hint', $hints[0]['type']);
        $this->assertSame('host-peer', $hints[0]['from']);

        $this->assertRelayEvent('bob', 'failed', 'issued');
    }

    public function test_precheck_accepts_a_wildcard_target_and_inserts_no_hint(): void
    {
        $this->configureRelay();
        $token = $this->userBearerToken();
        $this->joinAsMember('host-peer', $token);
        $guest = $this->withoutBearer()->guestJoin('guest-peer', 'Guest');

        $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'host-peer',
            'target' => '*',
            'reason' => 'precheck',
        ])->assertOk();

        $this->assertSame([], $this->pollGuest($guest['sessionKey']));
        $this->assertRelayEvent('bob', 'precheck', 'issued');
    }

    public function test_relay_is_unavailable_without_a_configured_secret(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org:3478',
            SettingKeys::RTC_TURN_SECRET => '',
        ]);
        $token = $this->userBearerToken();
        $this->joinAsMember('host-peer', $token);

        $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'host-peer',
            'target' => '*',
            'reason' => 'precheck',
        ])
            ->assertStatus(503)
            ->assertJson(['error' => 'relay_unavailable']);

        $this->assertRelayEvent('bob', 'precheck', 'unavailable');

        $notice = Notification::query()->where('principal', 'alice')->sole();
        $this->assertSame(
            "1 people couldn't connect directly to a call or document today.",
            $notice->title,
        );
        $this->assertSame('bob (Meet)', $notice->body);
        $this->assertStringNotContainsString('symmetric', (string) json_encode($notice->data));
    }

    public function test_admitted_guest_gets_credentials_on_a_reserved_room(): void
    {
        $this->configureRelay();
        $token = $this->userBearerToken();
        $this->reserveMeetRoom(token: $token)->assertCreated();
        $this->joinAsMember('host-peer', $token);

        $knock = $this->withoutBearer()->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'guest-peer',
            'name' => self::KNOCK_PREFIX.'Guest',
        ]);
        $knock->assertOk();
        $sessionKey = (string) $knock->json('sessionKey');

        // Still knocking: the door is not open, so neither is the relay.
        $this->withoutBearer()->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'guest-peer',
            'target' => 'host-peer',
            'reason' => 'failed',
            'sessionKey' => $sessionKey,
        ])
            ->assertForbidden()
            ->assertJson(['error' => 'relay_denied']);
        $this->assertRelayEvent('guest', 'failed', 'denied');

        $this->admitGuest($token, 'host-peer', 'guest-peer');
        $this->withoutBearer()->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'guest-peer',
            'name' => 'Guest',
            'sessionKey' => $sessionKey,
        ])->assertOk();

        $this->withoutBearer()->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'guest-peer',
            'target' => 'host-peer',
            'reason' => 'failed',
            'sessionKey' => $sessionKey,
        ])
            ->assertOk()
            ->assertJsonStructure(['turn' => ['urls', 'username', 'credential', 'ttl']]);
        $this->assertRelayEvent('guest', 'failed', 'issued');
    }

    public function test_guest_on_an_unreserved_code_needs_a_member_in_the_room(): void
    {
        $this->configureRelay();
        $guest = $this->withoutBearer()->guestJoin('guest-peer', 'Guest');
        $other = $this->withoutBearer()->guestJoin('other-peer', 'Other');

        $this->withoutBearer()->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'guest-peer',
            'target' => 'other-peer',
            'reason' => 'timeout',
            'sessionKey' => $guest['sessionKey'],
        ])
            ->assertForbidden()
            ->assertJson(['error' => 'relay_denied']);

        $this->joinAsMember('host-peer', $this->userBearerToken());

        $this->withoutBearer()->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'guest-peer',
            'target' => $other['peerId'],
            'reason' => 'timeout',
            'sessionKey' => $guest['sessionKey'],
        ])->assertOk();
    }

    public function test_relay_refuses_a_peer_the_actor_does_not_own(): void
    {
        $this->configureRelay();
        $this->withoutBearer()->guestJoin('guest-peer', 'Guest');
        $token = $this->userBearerToken();
        $this->joinAsMember('host-peer', $token);

        $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'guest-peer',
            'target' => 'host-peer',
            'reason' => 'failed',
        ])->assertForbidden();

        $this->assertSame(0, RtcRelayEvent::query()->count());
    }

    public function test_relay_rejects_an_unknown_reason_and_an_absent_target(): void
    {
        $this->configureRelay();
        $token = $this->userBearerToken();
        $this->joinAsMember('host-peer', $token);

        $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'host-peer',
            'target' => '*',
            'reason' => 'because',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'invalid_reason']);

        $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'host-peer',
            'target' => 'nobody-here',
            'reason' => 'failed',
        ])
            ->assertNotFound()
            ->assertJson(['error' => 'unknown_peer']);

        $this->assertSame(0, RtcRelayEvent::query()->count());
    }

    public function test_relay_is_capped_at_six_requests_per_minute_per_actor(): void
    {
        $this->configureRelay();
        $token = $this->userBearerToken();
        $this->joinAsMember('host-peer', $token);

        for ($request = 0; $request < 6; $request++) {
            $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
                'peerId' => 'host-peer',
                'target' => '*',
                'reason' => 'precheck',
            ])->assertOk();
        }

        $this->withBearer($token)->postJson($this->meetRoomPath('/relay'), [
            'peerId' => 'host-peer',
            'target' => '*',
            'reason' => 'precheck',
        ])->assertStatus(429);
    }

    private function configureRelay(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org:3478',
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);
    }

    private function joinAsMember(string $peerId, string $token): void
    {
        $this->withBearer($token)->postJson($this->meetRoomPath('/participants'), [
            'peerId' => $peerId,
            'name' => 'Host',
        ])->assertOk();
    }

    private function admitGuest(string $token, string $fromPeer, string $guestPeer): void
    {
        $control = json_encode(['kind' => 'admit', 'peerId' => $guestPeer], JSON_THROW_ON_ERROR);
        $this->withBearer($token)->postJson($this->meetRoomPath('/messages'), [
            'from' => $fromPeer,
            'text' => '__wgw_meet_control__:'.$control,
        ])->assertOk();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function pollGuest(string $sessionKey): array
    {
        $messages = $this->withoutBearer()
            ->getJson($this->meetRoomPath('/events').'?peerId=guest-peer&sessionKey='.$sessionKey)
            ->assertOk()
            ->json('messages');

        return is_array($messages) ? $messages : [];
    }

    private function assertRelayEvent(string $actor, string $reason, string $outcome): void
    {
        $this->assertTrue(
            RtcRelayEvent::query()
                ->where('channel', 'meet')
                ->where('actor', $actor)
                ->where('reason', $reason)
                ->where('outcome', $outcome)
                ->exists(),
            "Expected an rtc_relay_events row for {$actor}/{$reason}/{$outcome}.",
        );
    }
}
