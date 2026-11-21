<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CollabPeer;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\GroupMember;
use App\Models\MeetPeer;
use App\Models\Principal;
use App\Models\PrincipalPeer;
use App\Services\Rtc\Signaling\RtcPushHeartbeat;
use App\Services\Rtc\Signaling\RtcRoomPushState;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The push read as the room heartbeat (#2287): it refreshes `seen_at` for the
 * peers its browser names, only when the caller owns them. Peers nobody names
 * (a closed laptop) still expire. Like a room poll, it re-checks access first:
 * a revoked share, a downgrade or a removed Team member reaches the room.
 */
final class JmapPushRtcHeartbeatTest extends WgwDatabaseTestCase
{
    private const DOC = '/users/alice/docs/plan.md';

    private const GROUP_ROOM_ID = 'p_groups.design';

    protected function setUp(): void
    {
        parent::setUp();
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        Cache::flush();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedSharedTeam('studio', 'alice', 'bob');
        $this->shareWithBob(self::DOC);
    }

    public function test_a_push_read_keeps_the_named_own_peer_alive(): void
    {
        $alicePeer = $this->join('alice');
        $stale = time() - 60;
        CollabPeer::query()->update(['seen_at' => $stale]);

        $this->pushRead('alice', 'collab:'.$alicePeer)->assertOk();

        $this->assertGreaterThan($stale, $this->seenAt($alicePeer));
    }

    public function test_a_push_read_never_refreshes_another_users_peer(): void
    {
        $alicePeer = $this->join('alice');
        $stale = time() - 60;
        CollabPeer::query()->update(['seen_at' => $stale]);

        // bob knows alice's peer id from the roster; naming it moves nothing.
        $this->pushRead('bob', 'collab:'.$alicePeer)->assertOk();

        $this->assertSame($stale, $this->seenAt($alicePeer));
    }

    public function test_a_peer_nobody_names_still_expires(): void
    {
        $laptopPeer = $this->join('alice');
        $phonePeer = $this->join('alice');
        $stale = time() - RtcSignalingPolicy::collab()->peerTimeoutSeconds + 5;
        CollabPeer::query()->update(['seen_at' => $stale]);

        // The phone's browser keeps reading push; the closed laptop does not.
        $this->pushRead('alice', 'collab:'.$phonePeer)->assertOk();

        $this->assertSame($stale, $this->seenAt($laptopPeer));
        $this->assertGreaterThan($stale, $this->seenAt($phonePeer));
    }

    public function test_a_malformed_header_is_ignored_and_the_read_still_answers(): void
    {
        $alicePeer = $this->join('alice');
        $stale = time() - 60;
        CollabPeer::query()->update(['seen_at' => $stale]);

        $this->pushRead('alice', 'nope,collab:,collab:%%%,meet:'.$alicePeer.','.str_repeat('x', 5000))->assertOk();

        $this->assertSame($stale, $this->seenAt($alicePeer));
    }

    public function test_a_fresh_peer_costs_no_write(): void
    {
        $alicePeer = $this->join('alice');
        $fresh = time() - RtcPushHeartbeat::RECHECK_SECONDS + 10;
        CollabPeer::query()->update(['seen_at' => $fresh]);

        $this->pushRead('alice', 'collab:'.$alicePeer)->assertOk();

        $this->assertSame($fresh, $this->seenAt($alicePeer));
    }

    public function test_a_meet_peer_a_hidden_push_interval_old_is_refreshed(): void
    {
        $seen = time() - 25;
        MeetPeer::query()->insert([
            'room' => 'room-a',
            'peer_id' => 'meet-peer-1',
            'name' => 'Alice',
            'owner_user' => 'u:alice',
            'seen_at' => $seen,
        ]);

        $this->pushRead('alice', 'meet:meet-peer-1')->assertOk();

        $this->assertGreaterThan($seen, (int) MeetPeer::query()->where('peer_id', 'meet-peer-1')->value('seen_at'));
    }

    public function test_a_revoked_share_drops_the_peer_instead_of_keeping_it_alive(): void
    {
        $this->join('alice');
        $bobPeer = $this->join('bob');
        CollabPeer::query()->update(['seen_at' => time() - 60]);
        $aliceState = app(RtcRoomPushState::class)->stateFor('alice');

        DriveShareGrant::query()->where('grantee_user', 'bob')->delete();
        $this->pushRead('bob', 'collab:'.$bobPeer)->assertOk();

        $this->assertFalse(CollabPeer::query()->where('peer_id', $bobPeer)->exists());
        // alice's room rings, so her tab polls and drops bob from its roster.
        $this->assertNotSame($aliceState, app(RtcRoomPushState::class)->stateFor('alice'));
    }

    public function test_a_downgrade_reaches_the_roster_through_the_push_read(): void
    {
        $this->join('alice');
        $bobPeer = $this->join('bob');
        $this->assertSame('write', $this->access($bobPeer));
        CollabPeer::query()->update(['seen_at' => time() - 60]);
        $aliceState = app(RtcRoomPushState::class)->stateFor('alice');

        DriveShareGrant::query()->where('grantee_user', 'bob')->update(['access' => 'view']);
        $this->pushRead('bob', 'collab:'.$bobPeer)->assertOk();

        $this->assertSame('read', $this->access($bobPeer));
        $this->assertGreaterThan(time() - 60, $this->seenAt($bobPeer));
        $this->assertNotSame($aliceState, app(RtcRoomPushState::class)->stateFor('alice'));
    }

    public function test_a_peer_without_a_stored_room_path_is_not_kept_alive(): void
    {
        $alicePeer = $this->join('alice');
        $stale = time() - 60;
        CollabPeer::query()->update(['seen_at' => $stale, 'room_path' => null]);

        $this->pushRead('alice', 'collab:'.$alicePeer)->assertOk();

        $this->assertSame($stale, $this->seenAt($alicePeer));
    }

    public function test_a_removed_team_member_leaves_the_presence_room_on_the_push_read(): void
    {
        $group = $this->seedWgwGroup('principals/groups/design', 'Design');
        foreach (['alice', 'bob'] as $username) {
            $principal = Principal::forUsername($username);
            $this->assertNotNull($principal);
            $this->addPrincipalToGroup($group, $principal);
        }
        $this->joinPresence('alice');
        $bobPeer = $this->joinPresence('bob');
        PrincipalPeer::query()->update(['seen_at' => time() - 60]);
        $aliceState = app(RtcRoomPushState::class)->stateFor('alice');

        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        GroupMember::query()->where('principal_id', $group->id)->where('member_id', $bob->id)->delete();
        $this->pushRead('bob', 'principal:'.$bobPeer)->assertOk();

        $this->assertFalse(PrincipalPeer::query()->where('owner_user', 'u:bob')->exists());
        $this->assertNotSame($aliceState, app(RtcRoomPushState::class)->stateFor('alice'));
    }

    public function test_a_presence_member_is_kept_alive(): void
    {
        $group = $this->seedWgwGroup('principals/groups/design', 'Design');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($group, $alice);
        $alicePeer = $this->joinPresence('alice');
        $stale = time() - 60;
        PrincipalPeer::query()->update(['seen_at' => $stale]);

        $this->pushRead('alice', 'principal:'.$alicePeer)->assertOk();

        $this->assertGreaterThan($stale, (int) PrincipalPeer::query()->where('peer_id', $alicePeer)->value('seen_at'));
    }

    public function test_the_header_parser_validates_each_channel_and_caps_the_count(): void
    {
        $this->assertSame(
            ['collab' => ['0123456789abcdef'], 'principal' => ['alice-a1b2c3'], 'meet' => ['meet_peer_01']],
            RtcPushHeartbeat::parse(' collab:0123456789abcdef , principal:alice-a1b2c3,meet:meet_peer_01,collab:0123456789abcdef,chat:x1234567'),
        );
        // Collab peer ids are 16 hex characters; anything else is dropped.
        $this->assertSame([], RtcPushHeartbeat::parse('collab:ALICE-not-hex'));

        $many = implode(',', array_map(static fn (int $index): string => sprintf('collab:%016x', $index), range(1, 50)));
        $this->assertCount(RtcPushHeartbeat::MAX_PEERS, RtcPushHeartbeat::parse($many)['collab']);
    }

    /** @return TestResponse<Response> */
    private function pushRead(string $username, string $peers): TestResponse
    {
        return $this->call('GET', '/api/v1/jmap/events/RtcRoom/state/0', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$this->issueBearerTokenFor($username),
            'Accept' => 'text/event-stream',
            RtcPushHeartbeat::HEADER => $peers,
        ]));
    }

    private function seenAt(string $peerId): int
    {
        return (int) CollabPeer::query()->where('peer_id', $peerId)->value('seen_at');
    }

    private function access(string $peerId): string
    {
        return (string) CollabPeer::query()->where('peer_id', $peerId)->value('access');
    }

    private function joinPresence(string $username): string
    {
        $peerId = $this->withBearer($this->issueBearerTokenFor($username))
            ->postJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/participants', ['name' => ucfirst($username)])
            ->assertOk()
            ->json('peerId');
        $this->assertIsString($peerId);

        return $peerId;
    }

    private function join(string $username): string
    {
        $peerId = $this->withBearer($this->issueBearerTokenFor($username))
            ->postJson('/api/v1/rooms/'.RoomTestHelper::fileRoomId(self::DOC).'/participants', ['name' => ucfirst($username)])
            ->assertOk()
            ->json('peerId');
        $this->assertIsString($peerId);

        return $peerId;
    }

    private function shareWithBob(string $path): void
    {
        $share = new DriveShare;
        $share->id = (string) Str::uuid();
        $share->path = $path;
        $share->owner_username = 'alice';
        $share->kind = 'member';
        $share->default_access = 'edit';
        $share->save();

        $grant = new DriveShareGrant;
        $grant->id = (string) Str::uuid();
        $grant->share_id = $share->id;
        $grant->grantee_type = 'user';
        $grant->grantee_user = 'bob';
        $grant->access = 'edit';
        $grant->status = 'active';
        $grant->save();
    }
}
