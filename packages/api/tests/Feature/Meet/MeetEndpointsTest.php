<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Services\Settings\SettingKeys;
use Tests\Support\WgwDatabaseTestCase;

final class MeetEndpointsTest extends WgwDatabaseTestCase
{
    private const ROOM_ID = 'daily-room';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
    }

    public function test_room_status_empty_room(): void
    {
        $response = $this->getJson('/api/v1/meetings/rooms/'.self::ROOM_ID);

        $response->assertNotFound();
        $response->assertJson(['error' => 'not_found']);
    }

    public function test_guest_join_returns_session_key_and_peers(): void
    {
        $response = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'peer-alpha',
            'name' => 'Guest One',
        ]);

        $response->assertOk();
        $response->assertJsonStructure(['peers', 'sessionKey']);
        $this->assertIsString($response->json('sessionKey'));
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', (string) $response->json('sessionKey'));
    }

    public function test_poll_requires_session_or_auth(): void
    {
        $response = $this->getJson('/api/v1/rooms/'.self::ROOM_ID.'/events?peerId=peer-alpha');

        $response->assertUnauthorized();
        $response->assertJson(['error' => 'auth_required']);
    }

    public function test_guest_join_poll_leave_flow(): void
    {
        $join = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'peer-alpha',
            'name' => 'Guest One',
        ]);
        $join->assertOk();
        $sessionKey = (string) $join->json('sessionKey');

        $poll = $this->getJson('/api/v1/rooms/'.self::ROOM_ID.'/events?peerId=peer-alpha&sessionKey='.$sessionKey);
        $poll->assertOk();
        $poll->assertJsonStructure(['peers', 'messages']);

        $leave = $this->deleteJson('/api/v1/rooms/'.self::ROOM_ID.'/participants/peer-alpha', [
            'sessionKey' => $sessionKey,
        ]);
        $leave->assertOk();
        $leave->assertJson(['ok' => true]);
    }

    public function test_room_active_after_guest_join_requires_reservation(): void
    {
        $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'peer-alpha',
            'name' => 'Guest One',
        ])->assertOk();

        $this->getJson('/api/v1/meetings/rooms/'.self::ROOM_ID)
            ->assertNotFound()
            ->assertJson(['error' => 'not_found']);
    }

    public function test_guest_rejoin_reuses_session_key(): void
    {
        $first = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'peer-one',
            'name' => 'Guest',
        ]);
        $first->assertOk();
        $sessionKey = (string) $first->json('sessionKey');

        $this->deleteJson('/api/v1/rooms/'.self::ROOM_ID.'/participants/peer-one', [
            'sessionKey' => $sessionKey,
        ])->assertOk();

        $second = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'peer-two',
            'name' => 'Guest',
            'sessionKey' => $sessionKey,
        ]);
        $second->assertOk();
        $this->assertSame($sessionKey, $second->json('sessionKey'));

        $this->getJson('/api/v1/rooms/'.self::ROOM_ID.'/events?peerId=peer-two&sessionKey='.$sessionKey)
            ->assertOk();
    }

    public function test_chat_requires_session_or_auth(): void
    {
        $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'peer-alpha',
            'name' => 'Guest One',
        ])->assertOk();

        $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/messages', [
            'from' => 'peer-alpha',
            'text' => 'hello',
        ])
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }

    public function test_guest_chat_delivers_to_other_peer_via_poll(): void
    {
        $hostJoin = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'host-peer1',
            'name' => 'Host',
        ]);
        $hostJoin->assertOk();
        $hostSessionKey = (string) $hostJoin->json('sessionKey');

        $guestJoin = $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/participants', [
            'peerId' => 'guest-peer',
            'name' => 'Guest',
        ]);
        $guestJoin->assertOk();
        $guestSessionKey = (string) $guestJoin->json('sessionKey');

        $this->postJson('/api/v1/rooms/'.self::ROOM_ID.'/messages', [
            'from' => 'guest-peer',
            'text' => 'Hello host',
            'sessionKey' => $guestSessionKey,
        ])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $poll = $this->getJson('/api/v1/rooms/'.self::ROOM_ID.'/events?peerId=host-peer1&sessionKey='.$hostSessionKey);
        $poll->assertOk();

        $messages = $poll->json('messages');
        $this->assertIsArray($messages);
        $this->assertCount(1, $messages);
        $this->assertSame('chat', $messages[0]['type']);
        $this->assertSame('guest-peer', $messages[0]['from']);
        $this->assertSame(['text' => 'Hello host'], $messages[0]['payload']);
    }

    public function test_rtc_settings_endpoint_exposes_meet_ice_values(): void
    {
        $this->setAppSettings([
            SettingKeys::RTC_STUN_URL => "one.example.org:3478, \nstun:two.example.org",
            SettingKeys::RTC_TURN_URL => "turn:one.example.org\nturn-two.example.org:3478?transport=udp",
            SettingKeys::RTC_TURN_USERNAME => 'rtc-user',
            SettingKeys::RTC_TURN_CREDENTIAL => 'rtc-pass',
        ]);

        $response = $this->getJson('/api/v1/rooms/'.self::ROOM_ID.'/configuration');

        $response->assertOk();
        $response->assertJson([
            'rtc' => [
                'stunUrls' => 'stun:one.example.org:3478, stun:two.example.org',
                'turnUrls' => 'turn:one.example.org, turn:turn-two.example.org:3478?transport=udp',
                'turnUsername' => 'rtc-user',
                'turnPassword' => 'rtc-pass',
            ],
        ]);
        $response->assertJsonMissing(['forceRelay' => true]);
    }
}
