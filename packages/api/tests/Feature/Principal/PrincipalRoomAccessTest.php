<?php

declare(strict_types=1);

namespace Tests\Feature\Principal;

use App\Models\GroupMember;
use App\Models\Principal;
use App\Models\PrincipalPeer;
use App\Services\Settings\SettingKeys;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Group presence rooms follow the caller's current membership on every
 * request, not only on join, and every answer about a room the caller may not
 * use is the same whatever peer id is asked for.
 */
final class PrincipalRoomAccessTest extends WgwDatabaseTestCase
{
    private const GROUP_ROOM_ID = 'p_groups.design';

    private const WORKSPACE_ROOM_ID = 'p_workspace';

    private Principal $group;

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        $this->setAppSettings([
            SettingKeys::RTC_TURN_URL => 'turn:relay.example.org:3478',
            SettingKeys::RTC_TURN_SECRET => 'north',
        ]);

        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
        $this->group = $this->seedWgwGroup('principals/groups/design', 'Design');
        $this->addMember('alice');
        $this->addMember('bob');
    }

    public function test_a_removed_member_can_no_longer_poll_the_group_room(): void
    {
        $alicePeer = $this->join('alice');
        $bobPeer = $this->join('bob');
        $this->poll('bob', $bobPeer)->assertOk();

        $this->removeMember('bob');

        $this->poll('bob', $bobPeer)->assertForbidden()->assertJson(['error' => 'forbidden']);
        $roster = $this->poll('alice', $alicePeer)->assertOk()->json('peers');
        $this->assertNotContains($bobPeer, array_column($roster, 'id'));
    }

    public function test_a_removed_member_can_no_longer_send_in_the_group_room(): void
    {
        $alicePeer = $this->join('alice');
        $bobPeer = $this->join('bob');

        $this->removeMember('bob');

        $this->send('bob', $bobPeer, $alicePeer)->assertForbidden()->assertJson(['error' => 'forbidden']);
        $this->assertFalse(PrincipalPeer::query()->where('owner_user', 'u:bob')->exists());
    }

    public function test_a_removed_member_gets_no_relay_credentials(): void
    {
        $bobPeer = $this->join('bob');
        $this->relay('bob', $bobPeer)->assertOk();

        $this->removeMember('bob');

        $this->relay('bob', $bobPeer)->assertForbidden()->assertJson(['error' => 'forbidden']);
    }

    public function test_a_removed_member_may_still_leave_with_their_own_peer(): void
    {
        $alicePeer = $this->join('alice');
        $bobPeer = $this->join('bob');

        $this->removeMember('bob');

        $this->assertDenied($this->leave('bob', $alicePeer));
        $this->leave('bob', $bobPeer)->assertOk()->assertJson(['ok' => true]);
        $this->assertFalse(PrincipalPeer::query()->where('owner_user', 'u:bob')->exists());
        $this->assertTrue(PrincipalPeer::query()->where('peer_id', $alicePeer)->exists());
    }

    public function test_group_room_configuration_answers_only_to_members(): void
    {
        $this->configuration('alice', self::GROUP_ROOM_ID)->assertOk()->assertJsonStructure(['rtc' => ['stunUrls']]);
        $this->configuration('carol', self::GROUP_ROOM_ID)->assertForbidden()->assertJson(['error' => 'forbidden']);

        $this->removeMember('bob');

        $this->configuration('bob', self::GROUP_ROOM_ID)->assertForbidden()->assertJson(['error' => 'forbidden']);
    }

    public function test_workspace_room_configuration_answers_to_every_account(): void
    {
        $this->configuration('carol', self::WORKSPACE_ROOM_ID)->assertOk()->assertJsonStructure(['rtc' => ['stunUrls']]);
    }

    public function test_unknown_room_configuration_is_denied(): void
    {
        $this->configuration('alice', 'p_some-other-room')->assertForbidden()->assertJson(['error' => 'forbidden']);
    }

    public function test_a_non_member_gets_the_same_answer_for_a_live_and_an_unknown_peer_id(): void
    {
        $livePeer = $this->join('alice');
        $unknownPeer = 'alice-000000';

        foreach ([$livePeer, $unknownPeer] as $peerId) {
            $this->assertDenied($this->poll('carol', $peerId));
            $this->assertDenied($this->send('carol', $peerId, $livePeer));
            $this->assertDenied($this->relay('carol', $peerId));
            $this->assertDenied($this->leave('carol', $peerId));
        }

        $this->assertTrue(PrincipalPeer::query()->where('peer_id', $livePeer)->exists());
    }

    private function assertDenied(TestResponse $response): void
    {
        $response->assertForbidden();
        $this->assertSame([
            'error' => 'forbidden',
            'message' => 'You do not have access to this presence room.',
        ], $response->json());
    }

    private function join(string $username): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/participants', ['name' => ucfirst($username)])
            ->assertOk()
            ->json('peerId');
    }

    private function poll(string $username, string $peerId): TestResponse
    {
        return $this->asUser($username)
            ->getJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/events?peerId='.$peerId.'&since=0');
    }

    private function send(string $username, string $from, string $to): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/events', [
            'peerId' => $from,
            'to' => $to,
            'type' => 'offer',
            'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
        ]);
    }

    private function relay(string $username, string $peerId): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/relay', [
            'peerId' => $peerId,
            'target' => '*',
            'reason' => 'precheck',
        ]);
    }

    private function leave(string $username, string $peerId): TestResponse
    {
        return $this->asUser($username)
            ->deleteJson('/api/v1/rooms/'.self::GROUP_ROOM_ID.'/participants/'.$peerId);
    }

    private function configuration(string $username, string $roomId): TestResponse
    {
        return $this->asUser($username)->getJson('/api/v1/rooms/'.$roomId.'/configuration');
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    private function addMember(string $username): void
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);
        $this->addPrincipalToGroup($this->group, $principal);
    }

    private function removeMember(string $username): void
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);
        GroupMember::query()
            ->where('principal_id', $this->group->id)
            ->where('member_id', $principal->id)
            ->delete();
    }
}
