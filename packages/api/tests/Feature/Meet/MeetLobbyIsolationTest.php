<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Illuminate\Testing\TestResponse;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The lobby is not the call (#1099). A peer whose row still carries the knock
 * name prefix may not negotiate media, may not post ordinary room chat, and
 * does not receive room chat — only the `admit` / `deny` decision that names
 * that knocker. Control text (the knock announcement) is still allowed out.
 */
final class MeetLobbyIsolationTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const KNOCK_PREFIX = '__wgw_knock__:';

    private const CONTROL_PREFIX = '__wgw_meet_control__:';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_knocking_peer_cannot_send_offer_answer_or_ice(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        foreach (['offer', 'answer', 'ice'] as $type) {
            $this->postJson($this->meetRoomPath('/events'), [
                'from' => 'knock-peer',
                'to' => 'host-peer',
                'type' => $type,
                'payload' => ['sdp' => 'v=0'],
                'sessionKey' => $knocker['sessionKey'],
            ])
                ->assertForbidden()
                ->assertJson(['error' => 'forbidden']);
        }

        // Nothing reached the member, so no browser could answer the lobby.
        $this->getJson($this->meetRoomPath('/events?peerId=host-peer&sessionKey='.$host['sessionKey']))
            ->assertOk()
            ->assertJsonPath('messages', []);
    }

    public function test_admitted_peer_sends_media_signaling_again_after_rejoining(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        // Dropping the knock prefix is what ends the lobby for the send path.
        $this->guestJoin('knock-peer', 'Visitor', $knocker['sessionKey']);

        $this->postJson($this->meetRoomPath('/events'), [
            'from' => 'knock-peer',
            'to' => 'host-peer',
            'type' => 'offer',
            'payload' => ['sdp' => 'v=0'],
            'sessionKey' => $knocker['sessionKey'],
        ])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $this->getJson($this->meetRoomPath('/events?peerId=host-peer&sessionKey='.$host['sessionKey']))
            ->assertOk()
            ->assertJsonPath('messages.0.type', 'offer');
    }

    public function test_knocking_peer_receives_no_chat_lines(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $member = $this->guestJoin('member-peer', 'Member');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'host-peer',
            'text' => 'payroll is on Friday',
            'sessionKey' => $host['sessionKey'],
        ])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $this->poll('knock-peer', $knocker['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', [])
            ->assertDontSee('payroll is on Friday');

        // The people who are in the call still get the line.
        $this->poll('member-peer', $member['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages.0.payload.text', 'payroll is on Friday');
    }

    public function test_knocking_peer_receives_only_the_admit_or_deny_addressed_to_them(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $first = $this->guestJoin('knock-one', self::KNOCK_PREFIX.'Ada');
        $second = $this->guestJoin('knock-two', self::KNOCK_PREFIX.'Bram');

        $this->control($host['sessionKey'], ['kind' => 'admit', 'peerId' => 'knock-one'])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $this->poll('knock-one', $first['sessionKey'])
            ->assertOk()
            ->assertJsonPath(
                'messages.0.payload.text',
                self::CONTROL_PREFIX.json_encode(['kind' => 'admit', 'peerId' => 'knock-one'], JSON_THROW_ON_ERROR),
            );

        // A decision for someone else is not that knocker's business.
        $this->poll('knock-two', $second['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', []);

        $this->control($host['sessionKey'], ['kind' => 'deny', 'peerId' => 'knock-two'])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $this->poll('knock-two', $second['sessionKey'])
            ->assertOk()
            ->assertJsonPath(
                'messages.0.payload.text',
                self::CONTROL_PREFIX.json_encode(['kind' => 'deny', 'peerId' => 'knock-two'], JSON_THROW_ON_ERROR),
            );
    }

    public function test_other_control_messages_still_skip_the_lobby(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        // `end` and `mute` are for the call, not for the waiting room.
        $this->control($host['sessionKey'], ['kind' => 'end', 'by' => 'Host'])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 0]);
        $this->control($host['sessionKey'], ['kind' => 'mute', 'peerId' => 'knock-peer'])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 0]);

        $this->poll('knock-peer', $knocker['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', []);
    }

    public function test_knocking_peer_cannot_send_ordinary_chat(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $member = $this->guestJoin('member-peer', 'Member');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'knock-peer',
            'text' => 'payroll is on Friday',
            'sessionKey' => $knocker['sessionKey'],
        ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);

        $this->poll('host-peer', $host['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', [])
            ->assertDontSee('payroll is on Friday');

        $this->poll('member-peer', $member['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', [])
            ->assertDontSee('payroll is on Friday');
    }

    public function test_knocker_can_still_announce_the_knock_to_the_room(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        $this->control(
            $knocker['sessionKey'],
            ['kind' => 'knock', 'peerId' => 'knock-peer', 'name' => 'Visitor'],
            'knock-peer',
        )
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $this->poll('host-peer', $host['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages.0.from', 'knock-peer');
    }

    public function test_admitted_peer_can_send_ordinary_chat(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        // Dropping the knock prefix is what ends the lobby for the send path.
        $this->guestJoin('knock-peer', 'Visitor', $knocker['sessionKey']);

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'knock-peer',
            'text' => 'hello from the floor',
            'sessionKey' => $knocker['sessionKey'],
        ])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 1]);

        $this->poll('host-peer', $host['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages.0.payload.text', 'hello from the floor');
    }

    private function poll(string $peerId, string $sessionKey): TestResponse
    {
        return $this->getJson($this->meetRoomPath('/events?peerId='.$peerId.'&sessionKey='.$sessionKey));
    }

    /**
     * @param  array<string, mixed>  $control
     */
    private function control(string $sessionKey, array $control, string $fromPeer = 'host-peer'): TestResponse
    {
        return $this->postJson($this->meetRoomPath('/messages'), [
            'from' => $fromPeer,
            'text' => self::CONTROL_PREFIX.json_encode($control, JSON_THROW_ON_ERROR),
            'sessionKey' => $sessionKey,
        ]);
    }
}
