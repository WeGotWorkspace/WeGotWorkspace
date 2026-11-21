<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\MeetPeer;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Support\Facades\Cache;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The `MeetCall` push type (#2295): the doorbell for "a call runs in a channel I belong to".
 * A call starting or ending in a channel (or DM) of the caller moves the caller's state;
 * heartbeats, knocks and calls in channels the caller is not in never do.
 */
final class JmapPushMeetCallStateTest extends WgwDatabaseTestCase
{
    use InteractsWithJmapEventSource;

    private string $shared = '';

    private string $private = '';

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
        $this->seedSharedTeam('studio', 'alice', 'bob');
        $this->shared = $this->createChannel('alice', 'Standup');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$this->shared, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();
        $this->private = $this->createChannel('alice', 'Private');
    }

    public function test_a_caller_without_a_call_has_an_empty_state(): void
    {
        $this->assertSame('0', $this->stateOf('bob'));
        $this->assertSame('0', $this->stateOf('carol'));
    }

    public function test_a_call_starting_and_ending_in_a_member_channel_rings_the_member(): void
    {
        $bob = $this->firstId('bob');

        $this->join('alice', $this->shared, 'alice-peer');
        $bob = $this->assertChanged('bob', $bob);
        $this->assertNotSame('0', $this->stateOf('bob'));

        $this->asUser('alice')->deleteJson('/api/v1/rooms/'.$this->shared.'/participants/alice-peer')->assertSuccessful();
        $this->assertChanged('bob', $bob);
        $this->assertSame('0', $this->stateOf('bob'));
    }

    public function test_a_call_in_a_channel_the_caller_does_not_belong_to_does_not_ring(): void
    {
        $bob = $this->firstId('bob');
        $carol = $this->firstId('carol');

        $this->join('alice', $this->private, 'alice-peer');

        $this->assertNothingChanged('bob', $bob);
        $this->assertNothingChanged('carol', $carol);
        $this->assertSame('0', $this->stateOf('bob'));
    }

    public function test_a_direct_message_call_rings_the_peer(): void
    {
        $dm = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])->assertOk()->json('id');
        $bob = $this->firstId('bob');
        $carol = $this->firstId('carol');

        $this->join('alice', $dm, 'alice-dm');

        $this->assertChanged('bob', $bob);
        $this->assertNothingChanged('carol', $carol);
    }

    public function test_heartbeats_and_a_second_peer_in_a_running_call_do_not_ring(): void
    {
        $this->join('alice', $this->shared, 'alice-peer');
        $bob = $this->firstId('bob');

        MeetPeer::query()->update(['seen_at' => time() - 20]);
        $this->join('bob', $this->shared, 'bob-peer');

        // The room was active before bob joined and still is: the set of active rooms is the same.
        $this->assertNothingChanged('bob', $bob);
    }

    public function test_a_knocking_peer_does_not_start_a_call(): void
    {
        $bob = $this->firstId('bob');

        MeetPeer::query()->insert([
            'room' => $this->shared,
            'peer_id' => 'knock-peer',
            'name' => '__wgw_knock__:Guest',
            'owner_user' => 'g:guest',
            'seen_at' => time(),
        ]);

        $this->assertNothingChanged('bob', $bob);
    }

    public function test_a_call_drops_out_once_its_peers_timed_out(): void
    {
        $this->join('alice', $this->shared, 'alice-peer');
        $this->assertNotSame('0', $this->stateOf('bob'));

        MeetPeer::query()->update(['seen_at' => time() - RtcSignalingPolicy::meet()->peerTimeoutSeconds - 1]);

        $this->assertSame('0', $this->stateOf('bob'));
    }

    private function join(string $username, string $room, string $peerId): void
    {
        $this->asUser($username)->postJson('/api/v1/rooms/'.$room.'/participants', [
            'peerId' => $peerId,
            'name' => ucfirst($username),
        ])->assertOk();
    }

    private function createChannel(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/chat/channels', ['name' => $name, 'kind' => 'channel'])
            ->assertCreated()
            ->json('id');
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    private function stateOf(string $username): string
    {
        return $this->changedStates($this->readEventSource($this->issueBearerTokenFor($username), 'MeetCall'), $username)['MeetCall'];
    }

    private function firstId(string $username): string
    {
        $id = $this->readEventSource($this->issueBearerTokenFor($username), 'MeetCall')['id'];
        $this->assertIsString($id);

        return $id;
    }

    private function assertChanged(string $username, string $id): string
    {
        $stream = $this->readEventSource($this->issueBearerTokenFor($username), 'MeetCall', $id);
        $this->assertSame(['MeetCall'], array_keys($this->changedStates($stream, $username)));
        $this->assertIsString($stream['id']);

        return $stream['id'];
    }

    private function assertNothingChanged(string $username, string $id): void
    {
        $this->assertSame("retry: 3000\n\n", $this->eventSource($this->issueBearerTokenFor($username), 'MeetCall', $id)->getContent());
    }
}
