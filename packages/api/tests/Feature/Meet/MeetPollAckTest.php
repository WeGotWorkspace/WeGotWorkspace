<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Illuminate\Testing\TestResponse;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Acked mailboxes on GET /rooms/{roomId}/events (#1086). Meet used to delete
 * messages when they were read, so a lost poll response dropped the offer, the
 * chat line, or the `admit` and left a guest waiting in the lobby forever. A
 * peer that advertises the `since-ack` capability now polls with a cursor:
 * `since` is an ack, rows above it are redelivered until it moves. A peer
 * without the capability keeps delete-on-read, so a cached old client is not
 * handed its whole mailbox on every poll.
 */
final class MeetPollAckTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    private const KNOCK_PREFIX = '__wgw_knock__:';

    private const CONTROL_PREFIX = '__wgw_meet_control__:';

    /** @var list<string> */
    private const SINCE_ACK = ['since-ack'];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_dropped_poll_response_redelivers_offer_chat_and_admit_exactly_once(): void
    {
        $host = $this->authenticatedHost(caps: self::SINCE_ACK);
        $guest = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor', caps: self::SINCE_ACK);

        $this->controlAs($host, ['kind' => 'admit', 'peerId' => 'knock-peer'])->assertOk();
        // Admitted: dropping the knock prefix opens the media path again.
        $this->guestJoin('knock-peer', 'Visitor', $guest['sessionKey'], self::SINCE_ACK);
        $this->sendAs($host, 'host-peer', 'knock-peer', 'offer');
        $this->withBearer($host)->postJson($this->meetRoomPath('/messages'), [
            'from' => 'host-peer',
            'text' => 'starting now',
        ])->assertOk();
        $this->withoutBearer();

        // The response that carried all three never arrives, so the cursor stays at 0.
        $lost = $this->poll('knock-peer', $guest['sessionKey']);
        $lost->assertOk();
        $this->assertSame(
            ['chat', 'offer', 'chat'],
            array_column($this->messages($lost), 'type'),
        );

        $retry = $this->poll('knock-peer', $guest['sessionKey']);
        $retry->assertOk();
        $redelivered = $this->messages($retry);
        $this->assertSame(['chat', 'offer', 'chat'], array_column($redelivered, 'type'));
        $this->assertStringContainsString('admit', $redelivered[0]['payload']['text']);
        $this->assertSame('starting now', $redelivered[2]['payload']['text']);

        // Acking the last id consumes all three exactly once.
        $drained = $this->poll('knock-peer', $guest['sessionKey'], since: $redelivered[2]['id']);
        $drained->assertOk();
        $this->assertSame([], $this->messages($drained));
    }

    public function test_lobby_guest_receives_its_admit_exactly_once(): void
    {
        $host = $this->authenticatedHost(caps: self::SINCE_ACK);
        $guest = $this->guestJoin('knock-peer', self::KNOCK_PREFIX.'Visitor', caps: self::SINCE_ACK);

        $this->controlAs($host, ['kind' => 'admit', 'peerId' => 'knock-peer'])
            ->assertOk()
            ->assertJson(['delivered' => 1]);

        // A waiting guest polls with `since` too, so a lost response does not strand it.
        $first = $this->messages($this->poll('knock-peer', $guest['sessionKey']));
        $this->assertCount(1, $first);
        $this->assertStringContainsString('"kind":"admit"', $first[0]['payload']['text']);

        $acked = $this->poll('knock-peer', $guest['sessionKey'], since: $first[0]['id']);
        $acked->assertOk();
        $this->assertSame([], $this->messages($acked));

        // And it is not handed the admit a second time once acked.
        $this->assertSame(
            [],
            $this->messages($this->poll('knock-peer', $guest['sessionKey'], since: $first[0]['id'])),
        );
    }

    public function test_chat_is_not_duplicated_across_polls(): void
    {
        $host = $this->guestJoin('host-peer', 'Host', caps: self::SINCE_ACK);
        $guest = $this->guestJoin('guest-peer', 'Guest', caps: self::SINCE_ACK);

        foreach (['one', 'two'] as $text) {
            $this->postJson($this->meetRoomPath('/messages'), [
                'from' => 'host-peer',
                'text' => $text,
                'sessionKey' => $host['sessionKey'],
            ])->assertOk();
        }

        $first = $this->messages($this->poll('guest-peer', $guest['sessionKey']));
        $this->assertSame(['one', 'two'], array_column(array_column($first, 'payload'), 'text'));

        $cursor = $first[1]['id'];
        $this->assertSame([], $this->messages($this->poll('guest-peer', $guest['sessionKey'], since: $cursor)));

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'host-peer',
            'text' => 'three',
            'sessionKey' => $host['sessionKey'],
        ])->assertOk();

        $next = $this->messages($this->poll('guest-peer', $guest['sessionKey'], since: $cursor));
        $this->assertSame(['three'], array_column(array_column($next, 'payload'), 'text'));
    }

    public function test_mixed_room_serves_an_old_and_a_new_client(): void
    {
        $host = $this->guestJoin('host-peer', 'Host', caps: self::SINCE_ACK);
        $new = $this->guestJoin('new-peer', 'New client', caps: self::SINCE_ACK);
        $old = $this->guestJoin('old-peer', 'Old client');

        $this->postJson($this->meetRoomPath('/messages'), [
            'from' => 'host-peer',
            'text' => 'hello room',
            'sessionKey' => $host['sessionKey'],
        ])->assertOk()->assertJson(['delivered' => 2]);

        // The old client is drained on read and gets no row id to ack with.
        $oldFirst = $this->messages($this->poll('old-peer', $old['sessionKey']));
        $this->assertSame('hello room', $oldFirst[0]['payload']['text']);
        $this->assertArrayNotHasKey('id', $oldFirst[0]);
        $this->assertSame([], $this->messages($this->poll('old-peer', $old['sessionKey'])));

        // The new client keeps the line until it acks, then is clean.
        $newFirst = $this->messages($this->poll('new-peer', $new['sessionKey']));
        $this->assertSame('hello room', $newFirst[0]['payload']['text']);
        $this->assertSame(
            'hello room',
            $this->messages($this->poll('new-peer', $new['sessionKey']))[0]['payload']['text'],
        );
        $this->assertSame(
            [],
            $this->messages($this->poll('new-peer', $new['sessionKey'], since: $newFirst[0]['id'])),
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function messages(TestResponse $response): array
    {
        $messages = $response->json('messages');
        $this->assertIsArray($messages);

        return array_values($messages);
    }

    private function poll(string $peerId, string $sessionKey, int $since = 0): TestResponse
    {
        return $this->getJson($this->meetRoomPath(
            '/events?peerId='.$peerId.'&sessionKey='.$sessionKey.'&since='.$since,
        ));
    }

    /**
     * Host commands on an unreserved room require an authenticated actor.
     * A guest admit is refused, so the ack tests sign the host in.
     *
     * @param  list<string>|null  $caps
     */
    private function authenticatedHost(string $peerId = 'host-peer', ?array $caps = null): string
    {
        $token = $this->userBearerToken();
        $body = ['peerId' => $peerId, 'name' => 'Host'];
        if ($caps !== null) {
            $body['caps'] = $caps;
        }
        $this->withBearer($token)->postJson($this->meetRoomPath('/participants'), $body)->assertOk();
        $this->withoutBearer();

        return $token;
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

    private function sendAs(string $token, string $from, string $to, string $type): TestResponse
    {
        $response = $this->withBearer($token)->postJson($this->meetRoomPath('/events'), [
            'from' => $from,
            'to' => $to,
            'type' => $type,
            'payload' => ['sdp' => 'v=0'],
        ])->assertOk();
        $this->withoutBearer();

        return $response;
    }
}
