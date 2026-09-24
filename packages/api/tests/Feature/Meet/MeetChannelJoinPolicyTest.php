<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Models\ChatChannelMeta;
use App\Models\Principal;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Channel-ACL join policy for meet rooms (Epic #701 chunk H).
 *
 * Room = channel collection id (`chat-…` / `dm-…`) or a meeting channel's
 * stored `room_code`. Members (any ACL read access) join directly; authenticated
 * non-members are forced onto the knock path server-side. Guests (no account)
 * join only an ad-hoc room code. On that code they can knock, be admitted, and
 * re-join. Named channels, direct messages, name slugs, and plain room names
 * refuse them. Authenticated callers still join a plain room directly.
 */
final class MeetChannelJoinPolicyTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private const KNOCK_PREFIX = '__wgw_knock__:';

    private const CONTROL_PREFIX = '__wgw_meet_control__:';

    private string $channelId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
        $this->seedWgwUser('dave', displayName: 'Dave');

        $this->channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Team', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$this->channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();
    }

    public function test_owner_and_sharee_join_channel_room_directly_even_when_empty(): void
    {
        // Members never knock — including into an empty room (they open it).
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $join = $this->join('bob', $this->channelId, 'peer-bob', 'Bob')->assertOk();

        $this->assertNull($join->json('sessionKey'));
        $this->assertSame(['peer-alice'], array_column($join->json('peers'), 'id'));
    }

    public function test_group_member_joins_group_channel_room_directly(): void
    {
        $group = $this->seedWgwGroup('principals/groups/devs', 'Devs');
        $alice = Principal::query()->where('uri', 'principals/alice')->firstOrFail();
        $dave = Principal::query()->where('uri', 'principals/dave')->firstOrFail();
        $this->addPrincipalToGroup($group, $alice);
        $this->addPrincipalToGroup($group, $dave);

        $groupChannelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Dev talk', 'kind' => 'channel', 'groupSlug' => 'devs',
        ])->assertCreated()->json('id');

        $this->join('dave', $groupChannelId, 'peer-dave', 'Dave')->assertOk();
        // Same group channel: a non-member still cannot walk in.
        $this->join('carol', $groupChannelId, 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_internal_non_member_is_forced_onto_the_knock_path(): void
    {
        // Direct join rejected server-side, no matter what the client names itself.
        $this->join('carol', $this->channelId, 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        // Knocking at an empty room: nobody can admit → room_not_active.
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')
            ->assertNotFound()->assertJsonPath('error', 'room_not_active');

        // With a member in the call the knock is accepted (pending admission).
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();
    }

    public function test_guest_cannot_join_or_read_chat_on_a_channel_room(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $this->join('bob', $this->channelId, 'peer-bob', 'Bob')->assertOk();
        $this->sendChat('alice', $this->channelId, 'peer-alice', 'payroll is on Friday')->assertOk();

        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->guestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');

        $sessionKey = bin2hex(random_bytes(16));
        $this->flushHeaders()
            ->getJson('/api/v1/rooms/'.$this->channelId.'/events?peerId=peer-guest&sessionKey='.$sessionKey)
            ->assertStatus(403)
            ->assertJsonPath('error', 'forbidden')
            ->assertDontSee('payroll is on Friday');
        $this->flushHeaders()->postJson('/api/v1/rooms/'.$this->channelId.'/messages', [
            'from' => 'peer-guest',
            'sessionKey' => $sessionKey,
            'text' => 'hello',
        ])->assertStatus(403)->assertJsonPath('error', 'forbidden');

        $this->flushHeaders()
            ->getJson('/api/v1/chat/channels/'.$this->channelId.'/messages')
            ->assertUnauthorized();

        $this->asUser('bob')
            ->getJson('/api/v1/rooms/'.$this->channelId.'/events?peerId=peer-bob')
            ->assertOk()
            ->assertJsonPath('messages.0.payload.text', 'payroll is on Friday');
    }

    public function test_guest_is_always_rejected_on_dm_rooms(): void
    {
        // Chunk-G provisioning: find-or-create shares the dm to both members.
        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');
        $this->join('alice', $dmId, 'peer-alice', 'Alice')->assertOk();

        // Even with a member present, guests never enter DMs — knock or not.
        $this->guestJoin($dmId, 'peer-guest', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->guestJoin($dmId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->flushHeaders()
            ->getJson('/api/v1/rooms/'.$dmId.'/events?peerId=peer-guest&sessionKey='.bin2hex(random_bytes(16)))
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');

        // DM members join directly, as on any channel room.
        $this->join('bob', $dmId, 'peer-bob', 'Bob')->assertOk();
        // An internal non-member stays on the knock path (members could admit).
        $this->join('carol', $dmId, 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_guest_is_refused_on_a_named_meeting_while_internal_non_members_may_knock(): void
    {
        $created = $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Test', 'kind' => 'meeting',
        ])->assertCreated()->json();
        $meetingId = (string) $created['id'];
        $roomCode = (string) $created['guestRoomCode'];
        $this->assertSame('chat-'.$roomCode, $meetingId);
        $this->assertNotSame('chat-test', $meetingId);

        // The collection uri is not a guest door. The room code is.
        $this->guestJoin($meetingId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->guestJoin($roomCode, 'peer-guest', self::KNOCK_PREFIX.'Visitor')->assertOk();

        // Signed-in people who are not members can still knock on an empty meeting.
        $this->join('carol', $meetingId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();
    }

    public function test_signed_in_teammate_knock_shows_up_in_the_host_ad_hoc_room(): void
    {
        $room = 'g744-8kfg-adjz';
        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup',
            'kind' => 'meeting',
            'guestRoomCode' => $room,
        ])->assertCreated();

        $this->join('alice', $room, 'peer-alice', 'Alice')->assertOk();

        $knock = $this->join('bob', $room, 'peer-bob', self::KNOCK_PREFIX.'Bob')->assertOk();
        $this->assertContains('peer-alice', array_column($knock->json('peers'), 'id'));

        $poll = $this->asUser('alice')->getJson('/api/v1/rooms/'.$room.'/events?peerId=peer-alice&since=0');
        $poll->assertOk();
        $this->assertContains('peer-bob', array_column($poll->json('peers'), 'id'));
    }

    public function test_persisted_ad_hoc_guest_room_code_uses_meeting_acl(): void
    {
        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup',
            'kind' => 'meeting',
            'guestRoomCode' => 'g744-8kfg-adjz',
        ])->assertCreated()->assertJsonPath('guestRoomCode', 'g744-8kfg-adjz');

        $this->join('alice', 'g744-8kfg-adjz', 'peer-alice', 'Alice')->assertOk();
        $this->join('carol', 'g744-8kfg-adjz', 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
        $this->guestJoin('g744-8kfg-adjz', 'peer-guest', self::KNOCK_PREFIX.'Visitor')->assertOk();
        $this->guestJoin('g744-8kfg-adjz', 'peer-walkin', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
        $sessionKey = (string) $this->guestJoin('g744-8kfg-adjz', 'peer-reader', self::KNOCK_PREFIX.'Reader')
            ->assertOk()
            ->json('sessionKey');
        $this->sendChat('alice', 'g744-8kfg-adjz', 'peer-alice', 'the call is open')
            ->assertOk();
        $this->flushHeaders()
            ->getJson('/api/v1/rooms/g744-8kfg-adjz/events?peerId=peer-reader&sessionKey='.$sessionKey)
            ->assertOk()
            ->assertJsonPath('messages.0.payload.text', 'the call is open');
    }

    public function test_meeting_room_code_resolves_to_the_channel_acl(): void
    {
        $meetingId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup', 'kind' => 'meeting',
        ])->assertCreated()->json('id');
        $meta = ChatChannelMeta::query()->whereNotNull('kind')->where('kind', 'meeting')->firstOrFail();
        $meta->room_code = 'standup-guests';
        $meta->save();

        // The guest-link room code is the same channel for the policy.
        $this->join('alice', 'standup-guests', 'peer-alice', 'Alice')->assertOk();
        $this->join('carol', 'standup-guests', 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
        $this->guestJoin('standup-guests', 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');

        // …and the channel id itself resolves to the same policy.
        $this->join('carol', $meetingId, 'peer-carol2', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_plain_room_names_are_closed_to_guests(): void
    {
        // The invite UI refuses these ids. The API does too.
        $this->guestJoin('daily-room', 'peer-guest', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->guestJoin('empty-room', 'peer-guest2', self::KNOCK_PREFIX.'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->guestJoin('chat-nosuchchannel', 'peer-guest3', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        // Outside the mint alphabet (0 / i), so not a guest door.
        $this->guestJoin('team-sync-2026', 'peer-guest4', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
        $this->guestJoin('abcd-efgh-ijkl', 'peer-guest5', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');

        // An unreserved ad-hoc code has no host who can admit, so a direct
        // guest join still passes. A reserved code does not — see below.
        $direct = $this->guestJoin('abcd-efgh-jklm', 'peer-code', 'Visitor')->assertOk();
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', (string) $direct->json('sessionKey'));

        // Authenticated users join plain rooms unconditionally, knock or not.
        $this->join('carol', 'empty-room', 'peer-carol', 'Carol')->assertOk();
        $this->join('carol', 'other-room', 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();
    }

    public function test_admitted_guest_rejoins_an_ad_hoc_room_code_without_knocking(): void
    {
        $room = 'g744-8kfg-adjz';
        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup',
            'kind' => 'meeting',
            'guestRoomCode' => $room,
        ])->assertCreated();

        $this->join('alice', $room, 'peer-alice', 'Alice')->assertOk();
        $sessionKey = (string) $this->guestJoin($room, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertOk()
            ->json('sessionKey');

        $this->guestJoin($room, 'peer-guest', 'Visitor', $sessionKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        $this->sendControl('alice', $room, 'peer-alice', ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();

        $rejoin = $this->guestJoin($room, 'peer-guest', 'Visitor', $sessionKey)->assertOk();
        $this->assertContains('peer-alice', array_column($rejoin->json('peers'), 'id'));

        // Admission is bound to the guest session that knocked.
        $this->guestJoin($room, 'peer-guest', 'Impostor')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_guest_must_knock_on_a_reserved_ad_hoc_code(): void
    {
        $room = 'h8y8-ewp6-al8n';
        $this->asUser('alice')->postJson('/api/v1/meetings/rooms', [
            'room' => $room,
            'ownerPrincipal' => 'u:alice',
        ])->assertCreated();

        $this->guestJoin($room, 'peer-walkin', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        $sessionKey = (string) $this->guestJoin($room, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertOk()
            ->json('sessionKey');
        $this->guestJoin($room, 'peer-guest', 'Visitor', $sessionKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        // Someone who did not reserve the room cannot admit, even after joining.
        $this->join('carol', $room, 'peer-carol', 'Carol')->assertOk();
        $this->sendControl('carol', $room, 'peer-carol', ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();
        $this->guestJoin($room, 'peer-guest', 'Visitor', $sessionKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        $this->join('alice', $room, 'peer-alice', 'Alice')->assertOk();
        $this->sendControl('alice', $room, 'peer-alice', ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();
        $rejoin = $this->guestJoin($room, 'peer-guest', 'Visitor', $sessionKey)->assertOk();
        $this->assertContains('peer-alice', array_column($rejoin->json('peers'), 'id'));
        $this->guestJoin($room, 'peer-guest', 'Impostor')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        // Knocking again clears the admission.
        $this->guestJoin($room, 'peer-guest', self::KNOCK_PREFIX.'Visitor', $sessionKey)->assertOk();
        $this->guestJoin($room, 'peer-guest', 'Visitor', $sessionKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_admit_from_a_non_member_does_not_count(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();

        // A knocked-in internal non-member cannot admit themselves.
        $this->sendControl('carol', $this->channelId, 'peer-carol', ['kind' => 'admit', 'peerId' => 'peer-carol'])
            ->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        // A guest cannot ride an admit control aimed at a peer id they never joined with.
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'forbidden');
    }

    public function test_re_knock_resets_a_previous_admission(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();
        $this->sendControl('alice', $this->channelId, 'peer-alice', ['kind' => 'admit', 'peerId' => 'peer-carol'])
            ->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', 'Carol')->assertOk();

        // Knocking again (e.g. after leaving) starts a fresh, unadmitted knock.
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_admitted_internal_non_member_rejoins_without_knock(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();

        $this->sendControl('alice', $this->channelId, 'peer-alice', ['kind' => 'admit', 'peerId' => 'peer-carol'])
            ->assertOk();

        $this->join('carol', $this->channelId, 'peer-carol', 'Carol')->assertOk();
    }

    private function join(string $username, string $room, string $peerId, string $name): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/rooms/'.$room.'/participants', [
            'peerId' => $peerId,
            'name' => $name,
        ]);
    }

    private function guestJoin(string $room, string $peerId, string $name, ?string $sessionKey = null): TestResponse
    {
        $body = ['peerId' => $peerId, 'name' => $name];
        if ($sessionKey !== null) {
            $body['sessionKey'] = $sessionKey;
        }

        // Guests carry no bearer — drop default headers left by asUser().
        return $this->flushHeaders()->postJson('/api/v1/rooms/'.$room.'/participants', $body);
    }

    private function sendChat(string $username, string $room, string $fromPeer, string $text): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/rooms/'.$room.'/messages', [
            'from' => $fromPeer,
            'text' => $text,
        ]);
    }

    /**
     * @param  array<string, mixed>  $control
     */
    private function sendControl(string $username, string $room, string $fromPeer, array $control): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/rooms/'.$room.'/messages', [
            'from' => $fromPeer,
            'text' => self::CONTROL_PREFIX.json_encode($control, JSON_THROW_ON_ERROR),
        ]);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
