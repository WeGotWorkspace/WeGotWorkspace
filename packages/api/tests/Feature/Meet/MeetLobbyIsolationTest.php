<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Illuminate\Testing\TestResponse;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The lobby is not the call (#1099). A peer whose row still carries the knock
 * name prefix may not negotiate media, may not post ordinary room chat, and
 * may not send host commands (`end` / `mute` / `unmute` / `deny`). It does
 * not receive room chat — only the `admit` / `deny` decision that names that
 * knocker. Its own knock announcement is still allowed out.
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
        $host = $this->authenticatedHost();
        $first = $this->guestJoin('knock-one', self::KNOCK_PREFIX.'Ada');
        $second = $this->guestJoin('knock-two', self::KNOCK_PREFIX.'Bram');

        $this->controlAs($host, ['kind' => 'admit', 'peerId' => 'knock-one'])
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

        $this->controlAs($host, ['kind' => 'deny', 'peerId' => 'knock-two'])
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
        $host = $this->authenticatedHost();
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        // `end` and `mute` are for the call, not for the waiting room.
        // An unreserved room accepts them from an authenticated actor.
        $this->controlAs($host, ['kind' => 'end', 'by' => 'Host'])
            ->assertOk()
            ->assertJson(['ok' => true, 'delivered' => 0]);
        $this->controlAs($host, ['kind' => 'mute', 'peerId' => 'knock-peer'])
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

    public function test_knocking_peer_cannot_end_mute_unmute_or_deny_another_knocker(): void
    {
        $host = $this->guestJoin('host-peer', 'Host');
        $other = $this->guestJoin('knock-two', self::KNOCK_PREFIX.'Bram');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        foreach ([
            ['kind' => 'end', 'by' => 'Visitor'],
            ['kind' => 'mute', 'peerId' => 'host-peer'],
            ['kind' => 'unmute', 'peerId' => 'host-peer'],
            ['kind' => 'deny', 'peerId' => 'knock-two'],
        ] as $payload) {
            $this->control($knocker['sessionKey'], $payload, 'knock-peer')
                ->assertForbidden()
                ->assertJson(['error' => 'forbidden']);
        }

        // A knock that names someone else is not this row's announcement.
        $this->control(
            $knocker['sessionKey'],
            ['kind' => 'knock', 'peerId' => 'knock-two', 'name' => 'Visitor'],
            'knock-peer',
        )
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);

        $this->poll('host-peer', $host['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', []);
        $this->poll('knock-two', $other['sessionKey'])
            ->assertOk()
            ->assertJsonPath('messages', []);
    }

    public function test_guest_in_an_unreserved_call_cannot_send_host_controls(): void
    {
        $host = $this->authenticatedHost();
        $guest = $this->guestJoin('guest-peer', 'Guest');

        foreach ([
            ['kind' => 'end', 'by' => 'Guest'],
            ['kind' => 'mute', 'peerId' => 'host-peer'],
            ['kind' => 'unmute', 'peerId' => 'host-peer'],
            ['kind' => 'admit', 'peerId' => 'guest-peer'],
            ['kind' => 'deny', 'peerId' => 'host-peer'],
        ] as $payload) {
            $this->control($guest['sessionKey'], $payload, 'guest-peer')
                ->assertForbidden()
                ->assertJson(['error' => 'forbidden']);
        }

        $this->withBearer($host)
            ->getJson($this->meetRoomPath('/events?peerId=host-peer'))
            ->assertOk()
            ->assertJsonPath('messages', []);
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

    public function test_authorized_host_controls_are_stamped_and_a_forged_host_flag_is_not(): void
    {
        $host = $this->authenticatedHost();
        $viewer = $this->guestJoin('viewer-peer', 'Viewer');
        $knocker = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor');

        foreach ([
            ['kind' => 'end', 'by' => 'Host', 'host' => false],
            ['kind' => 'mute', 'peerId' => 'viewer-peer', 'host' => true],
            ['kind' => 'unmute', 'peerId' => 'viewer-peer'],
            ['kind' => 'deny', 'peerId' => 'viewer-peer'],
        ] as $control) {
            $this->controlAs($host, $control)->assertOk();
        }
        $this->controlAs($host, ['kind' => 'admit', 'peerId' => 'knock-peer'])->assertOk();

        $viewerMessages = $this->poll('viewer-peer', $viewer['sessionKey'])
            ->assertOk()
            ->json('messages');
        $this->assertIsArray($viewerMessages);
        $this->assertCount(5, $viewerMessages);
        foreach ($viewerMessages as $message) {
            $this->assertIsArray($message);
            $payload = $message['payload'] ?? null;
            $this->assertIsArray($payload);
            $this->assertTrue($payload['host'] ?? false);
        }

        $knockerMessages = $this->poll('knock-peer', $knocker['sessionKey'])
            ->assertOk()
            ->json('messages');
        $this->assertIsArray($knockerMessages);
        $this->assertCount(1, $knockerMessages);
        $this->assertTrue($knockerMessages[0]['payload']['host'] ?? false);
        $this->assertStringContainsString('"kind":"admit"', (string) $knockerMessages[0]['payload']['text']);

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'viewer-peer',
            'host' => true,
            'text' => self::CONTROL_PREFIX.json_encode([
                'kind' => 'end',
                'by' => 'Viewer',
                'host' => true,
            ], JSON_THROW_ON_ERROR),
            'sessionKey' => $viewer['sessionKey'],
        ])
            ->assertForbidden()
            ->assertJson(['error' => 'forbidden']);

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'knock-peer',
            'host' => true,
            'text' => self::CONTROL_PREFIX.json_encode([
                'kind' => 'knock',
                'peerId' => 'knock-peer',
                'name' => 'Visitor',
                'host' => true,
            ], JSON_THROW_ON_ERROR),
            'sessionKey' => $knocker['sessionKey'],
        ])
            ->assertOk();

        $hostMessages = $this->withBearer($host)
            ->getJson($this->meetRoomPath('/events?peerId=host-peer'))
            ->assertOk()
            ->json('messages');
        $this->assertIsArray($hostMessages);
        $forged = array_values(array_filter(
            $hostMessages,
            static fn (mixed $message): bool => is_array($message) && ($message['from'] ?? null) === 'knock-peer',
        ));
        $this->assertCount(1, $forged);
        $this->assertIsArray($forged[0]['payload']);
        $this->assertArrayNotHasKey('host', $forged[0]['payload']);
        $this->assertSame([], array_values(array_filter(
            $hostMessages,
            static fn (mixed $message): bool => is_array($message) && ($message['from'] ?? null) === 'viewer-peer',
        )));
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
     * Unreserved ad-hoc host: any authenticated actor may send host commands.
     */
    private function authenticatedHost(string $peerId = 'host-peer', string $name = 'Host'): string
    {
        $token = $this->userBearerToken();
        $this->withBearer($token)->postJson($this->meetRoomPath('/participants'), [
            'peerId' => $peerId,
            'name' => $name,
        ])->assertOk();
        $this->withoutBearer();

        return $token;
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

    /**
     * @param  array<string, mixed>  $control
     */
    private function controlAs(string $token, array $control, string $fromPeer = 'host-peer'): TestResponse
    {
        $response = $this->withBearer($token)->postJson($this->meetRoomPath('/messages'), [
            'from' => $fromPeer,
            'text' => self::CONTROL_PREFIX.json_encode($control, JSON_THROW_ON_ERROR),
        ]);
        $this->withoutBearer();

        return $response;
    }
}
