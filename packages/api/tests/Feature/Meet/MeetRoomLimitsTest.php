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

    public function test_fifth_peer_join_returns_room_full(): void
    {
        $this->guestJoin('peer-one', 'One');
        $this->guestJoin('peer-two', 'Two');
        $this->guestJoin('peer-three', 'Three');
        $this->guestJoin('peer-four', 'Four');

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'peer-five',
            'name' => 'Five',
        ])
            ->assertStatus(409)
            ->assertJson(['error' => 'room_full']);
    }

    public function test_knock_on_empty_room_returns_not_active(): void
    {
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'knock-peer',
            'name' => self::KNOCK_PREFIX.'Waiting Guest',
        ])
            ->assertNotFound()
            ->assertJson(['error' => 'room_not_active']);
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
        $this->withoutBearer();
        $host = $this->guestJoin('host-peer', 'Host');

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'knock-peer',
            'name' => self::KNOCK_PREFIX.'Waiting Guest',
        ])->assertOk();

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['active' => true]);

        $this->deleteJson($this->meetRoomPath('/participants/host-peer'), [
            'sessionKey' => $host['sessionKey'],
        ])->assertOk();

        $this->getJson($this->meetStatusPath())
            ->assertOk()
            ->assertJson(['active' => false]);
    }
}
