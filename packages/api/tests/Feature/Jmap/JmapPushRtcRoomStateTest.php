<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CollabPeer;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The `RtcRoom` push type (#2294): the doorbell for signaling rooms. A peer joining or
 * leaving, or a message to the caller's peer, moves the caller's state; a heartbeat poll
 * (`seen_at`) does not, and activity in a room where the caller has no live peer never does.
 */
final class JmapPushRtcRoomStateTest extends WgwDatabaseTestCase
{
    use InteractsWithJmapEventSource;

    private const DOC = '/users/alice/docs/plan.md';

    private const OTHER_DOC = '/users/alice/docs/other.md';

    protected function setUp(): void
    {
        parent::setUp();
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        Cache::flush();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
        // Epic #1915: a share only reaches a grantee who shares a Team with the owner.
        $this->seedSharedTeam('studio', 'alice', 'bob');
        $this->shareWithBob(self::DOC);
        $this->shareWithBob(self::OTHER_DOC);
    }

    public function test_a_caller_without_a_peer_has_an_empty_state(): void
    {
        $changed = $this->changedStates($this->readEventSource($this->issueBearerTokenFor('carol'), 'RtcRoom'), 'carol');

        $this->assertSame(['RtcRoom' => '0'], $changed);
    }

    public function test_a_newcomer_and_a_leaver_ring_the_peer_already_in_the_room(): void
    {
        $alicePeer = $this->join('alice', self::DOC);
        $alice = $this->firstId('alice');
        $carol = $this->firstId('carol');

        $bobPeer = $this->join('bob', self::DOC);
        $alice = $this->assertChanged('alice', $alice);

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->deleteJson('/api/v1/rooms/'.$this->roomId(self::DOC).'/participants/'.$bobPeer)
            ->assertSuccessful();
        $this->assertChanged('alice', $alice);

        // carol is in no room: nothing anywhere rings her.
        $this->assertNothingChanged('carol', $carol);
        $this->assertNotSame('', $alicePeer);
    }

    public function test_a_heartbeat_poll_does_not_ring(): void
    {
        $alicePeer = $this->join('alice', self::DOC);
        $this->join('bob', self::DOC);
        $alice = $this->firstId('alice');

        // Every heartbeat moves `seen_at`; the state must not follow it.
        foreach ([40, 20] as $ago) {
            CollabPeer::query()->update(['seen_at' => time() - $ago]);
            $this->poll('alice', self::DOC, $alicePeer);
        }

        $this->assertNothingChanged('alice', $alice);
    }

    public function test_a_message_to_the_callers_peer_rings_it(): void
    {
        $alicePeer = $this->join('alice', self::DOC);
        $bobPeer = $this->join('bob', self::DOC);
        $alice = $this->firstId('alice');
        $bob = $this->firstId('bob');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/rooms/'.$this->roomId(self::DOC).'/events', [
                'peerId' => $bobPeer,
                'to' => $alicePeer,
                'type' => 'offer',
                'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
            ])->assertOk();

        $this->assertChanged('alice', $alice);
        // The message is not addressed to bob's peer, and the roster did not change.
        $this->assertNothingChanged('bob', $bob);
    }

    public function test_activity_in_a_room_without_the_callers_peer_does_not_ring(): void
    {
        $this->join('alice', self::DOC);
        $alice = $this->firstId('alice');

        // bob may join the other document too; alice has no peer there.
        $bobPeer = $this->join('bob', self::OTHER_DOC);
        $this->poll('bob', self::OTHER_DOC, $bobPeer);

        $this->assertNothingChanged('alice', $alice);
    }

    public function test_a_room_drops_out_once_the_callers_peer_timed_out(): void
    {
        $this->join('alice', self::DOC);
        $this->join('bob', self::DOC);
        $this->assertNotSame('0', $this->stateOf('alice'));

        CollabPeer::query()->update(['seen_at' => time() - RtcSignalingPolicy::collab()->peerTimeoutSeconds - 1]);

        // A stale peer is not a membership: the room no longer reaches alice's state.
        $this->assertSame('0', $this->stateOf('alice'));
    }

    private function join(string $username, string $doc): string
    {
        $peerId = $this->withBearer($this->issueBearerTokenFor($username))
            ->postJson('/api/v1/rooms/'.$this->roomId($doc).'/participants', ['name' => ucfirst($username)])
            ->assertOk()
            ->json('peerId');
        $this->assertIsString($peerId);

        return $peerId;
    }

    private function poll(string $username, string $doc, string $peerId): void
    {
        $this->withBearer($this->issueBearerTokenFor($username))
            ->getJson('/api/v1/rooms/'.$this->roomId($doc).'/events?peerId='.$peerId.'&since=0')
            ->assertSuccessful();
    }

    private function stateOf(string $username): string
    {
        return $this->changedStates($this->readEventSource($this->issueBearerTokenFor($username), 'RtcRoom'), $username)['RtcRoom'];
    }

    private function firstId(string $username): string
    {
        $id = $this->readEventSource($this->issueBearerTokenFor($username), 'RtcRoom')['id'];
        $this->assertIsString($id);

        return $id;
    }

    /** Asserts that `RtcRoom` changed since `$id`; returns the new id. */
    private function assertChanged(string $username, string $id): string
    {
        $stream = $this->readEventSource($this->issueBearerTokenFor($username), 'RtcRoom', $id);
        $this->assertSame(['RtcRoom'], array_keys($this->changedStates($stream, $username)));
        $this->assertIsString($stream['id']);

        return $stream['id'];
    }

    private function assertNothingChanged(string $username, string $id): void
    {
        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->issueBearerTokenFor($username), 'RtcRoom', $id)->getContent());
    }

    private function roomId(string $doc): string
    {
        return RoomTestHelper::fileRoomId($doc);
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
