<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetGuestSessionTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_guest_join_returns_session_key_and_peers(): void
    {
        $response = $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'peer-alpha',
            'name' => 'Guest One',
        ]);

        $response->assertOk();
        $response->assertJsonStructure(['peers', 'sessionKey']);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', (string) $response->json('sessionKey'));
    }

    public function test_poll_requires_session_or_auth(): void
    {
        $this->getJson($this->meetRoomPath('/events?peerId=peer-alpha'))
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }

    public function test_guest_join_poll_leave_flow(): void
    {
        $join = $this->guestJoin('peer-alpha', 'Guest One');

        $this->getJson($this->meetRoomPath('/events?peerId=peer-alpha&sessionKey='.$join['sessionKey']))
            ->assertOk()
            ->assertJsonStructure(['peers', 'messages']);

        $this->deleteJson($this->meetRoomPath('/participants/peer-alpha'), [
            'sessionKey' => $join['sessionKey'],
        ])
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_guest_rejoin_reuses_session_key(): void
    {
        $first = $this->guestJoin('peer-one', 'Guest');
        $sessionKey = $first['sessionKey'];

        $this->deleteJson($this->meetRoomPath('/participants/peer-one'), [
            'sessionKey' => $sessionKey,
        ])->assertOk();

        $second = $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'peer-two',
            'name' => 'Guest',
            'sessionKey' => $sessionKey,
        ]);
        $second->assertOk();
        $this->assertSame($sessionKey, $second->json('sessionKey'));

        $this->getJson($this->meetRoomPath('/events?peerId=peer-two&sessionKey='.$sessionKey))
            ->assertOk();
    }

    public function test_send_requires_session_or_auth(): void
    {
        $this->guestJoin('peer-alpha', 'Guest');

        $this->postJson($this->meetRoomPath('/events'), [
            'from' => 'peer-alpha',
            'to' => 'peer-beta',
            'type' => 'offer',
            'payload' => ['sdp' => 'v=0'],
        ])
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }

    public function test_leave_requires_session_or_auth(): void
    {
        $this->guestJoin('peer-alpha', 'Guest');

        $this->deleteJson($this->meetRoomPath('/participants/peer-alpha'))
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }
}
