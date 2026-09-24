<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

final class MeetChatTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_chat_requires_session_or_auth(): void
    {
        $this->guestJoin('peer-alpha', 'Guest');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'peer-alpha',
            'text' => 'hello',
        ])
            ->assertUnauthorized()
            ->assertJson(['error' => 'auth_required']);
    }

    public function test_guest_chat_delivers_to_other_peer_via_poll(): void
    {
        $host = $this->guestJoin('host-peer1', 'Host');
        $guest = $this->guestJoin('guest-peer', 'Guest');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'guest-peer',
            'text' => 'Hello host',
            'sessionKey' => $guest['sessionKey'],
        ])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $poll = $this->getJson($this->meetRoomPath('/events?peerId=host-peer1&sessionKey='.$host['sessionKey']));
        $poll->assertOk();

        $messages = $poll->json('messages');
        $this->assertIsArray($messages);
        $this->assertCount(1, $messages);
        $this->assertSame('chat', $messages[0]['type']);
        $this->assertSame('guest-peer', $messages[0]['from']);
        $this->assertSame(['text' => 'Hello host'], $messages[0]['payload']);
    }

    public function test_empty_chat_text_returns_error(): void
    {
        $guest = $this->guestJoin('guest-peer', 'Guest');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'guest-peer',
            'text' => '   ',
            'sessionKey' => $guest['sessionKey'],
        ])
            ->assertStatus(400)
            ->assertJson(['error' => 'empty_text']);
    }

    public function test_authenticated_user_can_send_chat(): void
    {
        $bobToken = $this->userBearerToken();
        $host = $this->guestJoin('host-peer', 'Host');

        $this->withBearer($bobToken)
            ->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'bob-peer',
                'name' => 'Bob',
            ])
            ->assertOk();

        $this->withBearer($bobToken)
            ->postJson($this->meetRoomPath('/messages'), [
                'from' => 'bob-peer',
                'text' => 'Hi everyone',
            ])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $poll = $this->withoutBearer()
            ->getJson($this->meetRoomPath('/events?peerId=host-peer&sessionKey='.$host['sessionKey']));
        $poll->assertOk();
        $poll->assertJsonPath('messages.0.type', 'chat');
        $poll->assertJsonPath('messages.0.from', 'bob-peer');
        $poll->assertJsonPath('messages.0.payload.text', 'Hi everyone');
    }

    public function test_chat_delivered_count_matches_other_peers(): void
    {
        $this->guestJoin('peer-one', 'One');
        $this->guestJoin('peer-two', 'Two');
        $third = $this->guestJoin('peer-three', 'Three');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'peer-three',
            'text' => 'broadcast',
            'sessionKey' => $third['sessionKey'],
        ])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 2]);
    }

    public function test_chat_on_collab_room_returns_method_not_allowed(): void
    {
        $token = $this->adminBearerToken();
        // Collab join checks document access, so the room targets alice's own home.
        $collabRoomId = RoomTestHelper::fileRoomId('/users/alice/docs/test.md');

        $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$collabRoomId.'/participants', [
                'name' => 'Alice',
            ])
            ->assertOk();

        $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$collabRoomId.'/messages', [
                'from' => 'ignored',
                'text' => 'hello',
            ])
            ->assertStatus(405)
            ->assertJsonPath('code', 'method_not_allowed');
    }
}
