<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetRoomLimitsTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const KNOCK_PREFIX = '__wgw_knock__:';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_seventh_peer_join_returns_room_full(): void
    {
        $this->guestJoin('peer-one', 'One');
        $this->guestJoin('peer-two', 'Two');
        $this->guestJoin('peer-three', 'Three');
        $this->guestJoin('peer-four', 'Four');
        $this->guestJoin('peer-five', 'Five');
        $this->guestJoin('peer-six', 'Six');

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'peer-seven',
            'name' => 'Seven',
        ])
            ->assertStatus(409)
            ->assertExactJson(['error' => 'room_full', 'code' => 'room_full']);
    }

    public function test_knock_on_empty_room_returns_not_active(): void
    {
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'knock-peer',
            'name' => self::KNOCK_PREFIX.'Waiting Guest',
        ])
            ->assertNotFound()
            ->assertExactJson(['error' => 'room_not_active', 'code' => 'room_not_active']);
    }

    public function test_knock_join_succeeds_when_host_is_present(): void
    {
        $this->guestJoin('host-peer', 'Host');

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'knock-peer',
            'name' => self::KNOCK_PREFIX.'Waiting Guest',
        ])
            ->assertOk()
            ->assertJsonStructure(['sessionKey', 'peers']);
    }

    public function test_knock_alone_does_not_make_room_active(): void
    {
        $this->reserveMeetRoom()->assertCreated();

        // A reserved code rejects a direct guest join. The host is the
        // member who reserved the room; only their presence counts as active.
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'host-peer',
            'name' => 'Host',
        ])->assertOk();

        $this->withoutBearer()->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'knock-peer',
            'name' => self::KNOCK_PREFIX.'Waiting Guest',
        ])->assertOk();

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['active' => true]);

        $this->withBearer($this->userBearerToken())
            ->deleteJson($this->meetRoomPath('/participants/host-peer'))
            ->assertOk();

        $this->withoutBearer()
            ->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['active' => false]);
    }
}
