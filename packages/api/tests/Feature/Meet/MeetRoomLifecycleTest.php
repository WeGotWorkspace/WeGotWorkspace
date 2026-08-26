<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetRoomLifecycleTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_empty_room_without_reservation_is_not_found(): void
    {
        $this->getJson($this->meetStatusPath())
            ->assertNotFound()
            ->assertJson(['error' => 'not_found']);
    }

    public function test_reserved_empty_room_is_not_active(): void
    {
        $this->reserveMeetRoom()->assertCreated();

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['reserved' => true, 'active' => false]);
    }

    public function test_room_becomes_active_after_guest_join(): void
    {
        $this->reserveMeetRoom()->assertCreated();
        $this->withoutBearer();
        $this->guestJoin('host-peer', 'Host');

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['reserved' => true, 'active' => true]);
    }

    public function test_room_inactive_after_all_peers_leave(): void
    {
        $this->reserveMeetRoom()->assertCreated();
        $this->withoutBearer();
        $join = $this->guestJoin('solo-peer', 'Solo');

        $this->deleteJson($this->meetRoomPath('/participants/solo-peer'), [
            'sessionKey' => $join['sessionKey'],
        ])->assertOk();

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['reserved' => true, 'active' => false]);
    }

    public function test_authenticated_join_makes_room_active(): void
    {
        $this->reserveMeetRoom()->assertCreated();
        $token = $this->userBearerToken();

        $this->withBearer($token)
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'bob-peer',
                'name' => 'Bob',
            ])
            ->assertOk();

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['reserved' => true, 'active' => true]);
    }
}
