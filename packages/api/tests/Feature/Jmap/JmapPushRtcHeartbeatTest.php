<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CollabPeer;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\MeetPeer;
use App\Services\Rtc\Signaling\RtcPushHeartbeat;
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
        $stale = time() - 40;
        $this->seedMeetPeer('meet_alice_1', 'alice', $stale);

        $this->pushRead('alice', 'meet:meet_alice_1')->assertOk();

        $this->assertGreaterThan($stale, $this->meetSeenAt('meet_alice_1'));
    }

    public function test_a_push_read_never_refreshes_another_users_peer(): void
    {
        $stale = time() - 40;
        $this->seedMeetPeer('meet_alice_1', 'alice', $stale);

        // bob knows alice's peer id from the roster; naming it moves nothing.
        $this->pushRead('bob', 'meet:meet_alice_1')->assertOk();

        $this->assertSame($stale, $this->meetSeenAt('meet_alice_1'));
    }

    public function test_a_peer_nobody_names_still_expires(): void
    {
        $stale = time() - RtcSignalingPolicy::meet()->peerTimeoutSeconds + 5;
        $this->seedMeetPeer('meet_laptop_1', 'alice', $stale);
        $this->seedMeetPeer('meet_phone_1', 'alice', $stale);

        // The phone's browser keeps reading push; the closed laptop does not.
        $this->pushRead('alice', 'meet:meet_phone_1')->assertOk();

        $this->assertSame($stale, $this->meetSeenAt('meet_laptop_1'));
        $this->assertGreaterThan($stale, $this->meetSeenAt('meet_phone_1'));
    }

    public function test_a_push_read_never_refreshes_collab_or_principal_peers(): void
    {
        $collabPeer = $this->join('alice');
        $stale = time() - 60;
        CollabPeer::query()->update(['seen_at' => $stale]);

        $this->pushRead('alice', 'collab:'.$collabPeer.',principal:alice-a1b2c3')->assertOk();

        $this->assertSame($stale, $this->seenAt($collabPeer));
    }

    public function test_a_malformed_header_is_ignored_and_the_read_still_answers(): void
    {
        $stale = time() - 40;
        $this->seedMeetPeer('meet_alice_1', 'alice', $stale);

        $this->pushRead('alice', 'nope,meet:,meet:%%%,collab:x,'.str_repeat('x', 5000))->assertOk();

        $this->assertSame($stale, $this->meetSeenAt('meet_alice_1'));
    }

    public function test_the_header_parser_validates_meet_ids_and_caps_the_count(): void
    {
        $this->assertSame(
            ['meet' => ['meet_peer_01']],
            RtcPushHeartbeat::parse(' collab:0123456789abcdef , principal:alice-a1b2c3,meet:meet_peer_01,meet:meet_peer_01,chat:x1234567'),
        );
        // Meet peer ids are 4-64 characters of [A-Za-z0-9_-]; anything else is dropped.
        $this->assertSame([], RtcPushHeartbeat::parse('meet:no spaces!'));

        $many = implode(',', array_map(static fn (int $index): string => sprintf('meet:meet_peer_%02d', $index), range(1, 50)));
        $this->assertCount(RtcPushHeartbeat::MAX_PEERS, RtcPushHeartbeat::parse($many)['meet']);
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

    private function seedMeetPeer(string $peerId, string $username, int $seenAt): void
    {
        MeetPeer::query()->insert([
            'room' => 'room-a',
            'peer_id' => $peerId,
            'name' => 'Peer',
            'owner_user' => 'u:'.$username,
            'seen_at' => $seenAt,
        ]);
    }

    private function meetSeenAt(string $peerId): int
    {
        return (int) MeetPeer::query()->where('peer_id', $peerId)->value('seen_at');
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
