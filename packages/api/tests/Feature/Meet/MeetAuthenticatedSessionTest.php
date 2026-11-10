<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetAuthenticatedSessionTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_authenticated_join_omits_session_key(): void
    {
        $response = $this->withBearer($this->userBearerToken())
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'bob-peer',
                'name' => 'Bob',
            ]);

        $response->assertOk();
        $response->assertJson(['sessionKey' => null]);
    }

    public function test_authenticated_user_can_poll_send_and_leave_without_session_key(): void
    {
        $token = $this->userBearerToken();

        $this->withBearer($token)
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'bob-peer',
                'name' => 'Bob',
            ])
            ->assertOk();

        $this->withBearer($token)
            ->getJson($this->meetRoomPath('/events?peerId=bob-peer'))
            ->assertOk()
            ->assertJsonStructure(['peers', 'messages']);

        $this->withBearer($token)
            ->postJson($this->meetRoomPath('/events'), [
                'from' => 'bob-peer',
                'to' => 'nobody',
                'type' => 'offer',
                'payload' => ['sdp' => 'v=0'],
            ])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->withBearer($token)
            ->deleteJson($this->meetRoomPath('/participants/bob-peer'))
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    public function test_two_authenticated_users_see_each_other_in_peer_list(): void
    {
        $bobToken = $this->userBearerToken();
        $aliceToken = $this->adminBearerToken();

        $this->withBearer($bobToken)
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'bob-peer',
                'name' => 'Bob',
            ])
            ->assertOk();

        $aliceJoin = $this->withBearer($aliceToken)
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'alice-peer',
                'name' => 'Alice',
            ]);
        $aliceJoin->assertOk();
        $aliceJoin->assertJsonPath('peers.0.id', 'bob-peer');
        $aliceJoin->assertJsonPath('peers.0.name', 'Bob');

        $bobPoll = $this->withBearer($bobToken)
            ->getJson($this->meetRoomPath('/events?peerId=bob-peer'));
        $bobPoll->assertOk();
        $bobPoll->assertJsonPath('peers.0.id', 'alice-peer');
        $bobPoll->assertJsonPath('peers.0.name', 'Alice');
    }

    public function test_admin_has_no_special_meet_privileges_over_regular_user(): void
    {
        $carolToken = $this->carolBearerToken();
        $adminToken = $this->adminBearerToken();

        $this->withBearer($carolToken)
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'carol-peer',
                'name' => 'Carol',
            ])
            ->assertOk();

        $this->withBearer($adminToken)
            ->postJson($this->meetRoomPath('/events'), [
                'from' => 'carol-peer',
                'to' => 'admin-peer',
                'type' => 'offer',
                'payload' => ['sdp' => 'v=0'],
            ])
            ->assertForbidden()
            ->assertExactJson(['error' => 'forbidden', 'code' => 'forbidden']);
    }
}
