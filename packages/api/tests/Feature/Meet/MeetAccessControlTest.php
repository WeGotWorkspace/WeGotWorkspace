<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetAccessControlTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_guest_cannot_poll_another_guests_peer(): void
    {
        $guestA = $this->guestJoin('peer-a', 'Guest A');
        $this->guestJoin('peer-b', 'Guest B');

        $this->getJson($this->meetRoomPath('/events?peerId=peer-b&sessionKey='.$guestA['sessionKey']))
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_guest_cannot_send_as_another_guests_peer(): void
    {
        $guestA = $this->guestJoin('peer-a', 'Guest A');
        $this->guestJoin('peer-b', 'Guest B');

        $this->postJson($this->meetRoomPath('/events'), [
            'from' => 'peer-b',
            'to' => 'peer-a',
            'type' => 'offer',
            'payload' => ['sdp' => 'v=0'],
            'sessionKey' => $guestA['sessionKey'],
        ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_guest_cannot_leave_another_guests_peer(): void
    {
        $guestA = $this->guestJoin('peer-a', 'Guest A');
        $this->guestJoin('peer-b', 'Guest B');

        $this->deleteJson($this->meetRoomPath('/participants/peer-b'), [
            'sessionKey' => $guestA['sessionKey'],
        ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_wrong_session_key_on_poll_returns_unauthorized(): void
    {
        $this->guestJoin('peer-a', 'Guest');

        $this->getJson($this->meetRoomPath('/events?peerId=peer-a&sessionKey='.str_repeat('a', 32)))
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_poll_unknown_peer_returns_not_found(): void
    {
        $guest = $this->guestJoin('peer-a', 'Guest');

        $this->getJson($this->meetRoomPath('/events?peerId=missing-peer&sessionKey='.$guest['sessionKey']))
            ->assertNotFound()
            ->assertJson(['error' => 'unknown_peer']);
    }

    public function test_invalid_room_id_returns_bad_request(): void
    {
        $this->postJson('/api/v1/rooms/abc/participants', [
            'peerId' => 'peer-one',
            'name' => 'Guest',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'invalid_room']);
    }

    public function test_invalid_peer_id_returns_bad_request(): void
    {
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'bad',
            'name' => 'Guest',
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'invalid_peer']);
    }

    public function test_guest_can_join_without_bearer_token(): void
    {
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'guest-peer',
            'name' => 'Guest',
        ])
            ->assertOk()
            ->assertJsonStructure(['sessionKey', 'peers']);
    }

    public function test_meeting_status_is_public(): void
    {
        $this->reserveMeetRoom()->assertCreated();

        $this->withoutBearer()
            ->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertExactJson([
                'reserved' => true,
                'active' => false,
            ]);
    }
}
