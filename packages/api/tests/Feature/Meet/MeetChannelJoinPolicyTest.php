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
 * guest `room_code`. Members (any ACL read access) join directly; non-members
 * and guests are forced onto the knock path server-side (the old client
 * naming convention alone no longer suffices); guests never join dm- rooms;
 * non-channel rooms keep the legacy behavior byte-for-byte.
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

    public function test_guest_is_forced_onto_the_knock_path_on_channel_rooms(): void
    {
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $knock = $this->guestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')->assertOk();
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', (string) $knock->json('sessionKey'));
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

        // DM members join directly, as on any channel room.
        $this->join('bob', $dmId, 'peer-bob', 'Bob')->assertOk();
        // An internal non-member stays on the knock path (members could admit).
        $this->join('carol', $dmId, 'peer-carol', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
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
        $this->guestJoin('standup-guests', 'peer-guest', self::KNOCK_PREFIX.'Visitor')->assertOk();

        // …and the channel id itself resolves to the same policy.
        $this->join('carol', $meetingId, 'peer-carol2', 'Carol')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_non_channel_rooms_keep_legacy_behavior(): void
    {
        // Guests join plain rooms directly (lobby gating is client-side there).
        $direct = $this->guestJoin('daily-room', 'peer-guest', 'Visitor')->assertOk();
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/', (string) $direct->json('sessionKey'));

        // Guest knock on an empty plain room stays room_not_active.
        $this->guestJoin('empty-room', 'peer-guest2', self::KNOCK_PREFIX.'Visitor')
            ->assertNotFound()->assertJsonPath('error', 'room_not_active');

        // Authenticated users join plain rooms unconditionally, knock or not.
        $this->join('carol', 'empty-room', 'peer-carol', 'Carol')->assertOk();
        $this->join('carol', 'other-room', 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();

        // A chat-prefixed room with no matching collection is a plain room.
        $this->guestJoin('chat-nosuchchannel', 'peer-guest3', 'Visitor')->assertOk();
    }

    public function test_knock_then_admit_flow_lets_the_guest_rejoin_without_knocking(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $sessionKey = (string) $this->guestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertOk()->json('sessionKey');

        // Not admitted yet: the non-knock rename join is refused.
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor', $sessionKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        // A member's admit control message records the admission server-side.
        $this->sendControl('alice', $this->channelId, 'peer-alice', ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();

        // The admitted guest re-joins as a normal participant (same peer id +
        // session key — the client's updateJoinName rejoin).
        $rejoin = $this->guestJoin($this->channelId, 'peer-guest', 'Visitor', $sessionKey)->assertOk();
        $this->assertContains('peer-alice', array_column($rejoin->json('peers'), 'id'));

        // Admission is bound to the actor: a different guest session cannot
        // ride the admitted peer id.
        $this->guestJoin($this->channelId, 'peer-guest', 'Impostor')
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_admit_from_non_members_and_guests_does_not_count(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $guestKey = (string) $this->guestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertOk()->json('sessionKey');

        // The knocker cannot admit themselves…
        $this->sendGuestControl($this->channelId, 'peer-guest', $guestKey, ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor', $guestKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');

        // …and a knocked-in internal non-member cannot admit others either.
        $this->join('carol', $this->channelId, 'peer-carol', self::KNOCK_PREFIX.'Carol')->assertOk();
        $this->sendControl('carol', $this->channelId, 'peer-carol', ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor', $guestKey)
            ->assertStatus(403)->assertJsonPath('error', 'knock_required');
    }

    public function test_re_knock_resets_a_previous_admission(): void
    {
        $this->join('alice', $this->channelId, 'peer-alice', 'Alice')->assertOk();
        $guestKey = (string) $this->guestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor')
            ->assertOk()->json('sessionKey');
        $this->sendControl('alice', $this->channelId, 'peer-alice', ['kind' => 'admit', 'peerId' => 'peer-guest'])
            ->assertOk();
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor', $guestKey)->assertOk();

        // Knocking again (e.g. after leaving) starts a fresh, unadmitted knock.
        $this->guestJoin($this->channelId, 'peer-guest', self::KNOCK_PREFIX.'Visitor', $guestKey)->assertOk();
        $this->guestJoin($this->channelId, 'peer-guest', 'Visitor', $guestKey)
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

    /**
     * @param  array<string, mixed>  $control
     */
    private function sendGuestControl(string $room, string $fromPeer, string $sessionKey, array $control): TestResponse
    {
        return $this->flushHeaders()->postJson('/api/v1/rooms/'.$room.'/messages', [
            'from' => $fromPeer,
            'sessionKey' => $sessionKey,
            'text' => self::CONTROL_PREFIX.json_encode($control, JSON_THROW_ON_ERROR),
        ]);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
