<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CollabPeer;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Rtc\Signaling\RtcPushHeartbeat;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The push read as the room heartbeat (#2287): it refreshes `seen_at` for the
 * peers its browser names, only when the caller owns them. Peers nobody names
 * (a closed laptop) still expire.
 */
final class JmapPushRtcHeartbeatTest extends WgwDatabaseTestCase
{
    private const DOC = '/users/alice/docs/plan.md';

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
