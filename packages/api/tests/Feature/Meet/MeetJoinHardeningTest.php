<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use App\Models\MeetPeer;
use App\Services\Settings\SettingKeys;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetJoinHardeningTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_a_peer_id_held_by_another_actor_cannot_be_taken_over(): void
    {
        $this->guestJoin('shared-peer', 'First Guest');

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'shared-peer',
            'name' => 'Impostor',
        ])
            ->assertStatus(409)
            ->assertJson(['error' => 'peer_id_taken', 'code' => 'peer_id_taken']);

        $this->assertSame('First Guest', MeetPeer::query()
            ->where('peer_id', 'shared-peer')
            ->value('name'));
    }

    public function test_the_owning_actor_may_rejoin_its_own_peer_id(): void
    {
        $first = $this->guestJoin('shared-peer', 'First Guest');

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'shared-peer',
            'name' => 'First Guest Reloaded',
            'sessionKey' => $first['sessionKey'],
        ])->assertOk();

        $this->assertSame(1, MeetPeer::query()->where('peer_id', 'shared-peer')->count());
    }

    public function test_a_ghost_peer_releases_its_id_after_the_sixty_second_timeout(): void
    {
        config(['wgw.rtc.prune_one_in' => 1]);
        $this->guestJoin('shared-peer', 'Ghost');
        MeetPeer::query()->where('peer_id', 'shared-peer')->update(['seen_at' => time() - 61]);

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'shared-peer',
            'name' => 'Newcomer',
        ])->assertOk();

        $this->assertSame('Newcomer', MeetPeer::query()
            ->where('peer_id', 'shared-peer')
            ->value('name'));
    }

    public function test_join_stores_capabilities_and_net_class_for_the_roster(): void
    {
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-peer',
            'name' => 'Alice',
            'caps' => ['bin', 'ice-batch', 'nonsense'],
            'net' => 'udp-blocked',
        ])->assertOk();

        $peer = MeetPeer::query()->where('peer_id', 'alice-peer')->firstOrFail();
        $this->assertSame('bin,ice-batch', $peer->caps);
        $this->assertSame('udp-blocked', $peer->net);

        $roster = $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'bob-peer',
            'name' => 'Bob',
        ])->json('peers');
        $alice = collect($roster)->firstWhere('id', 'alice-peer');
        $this->assertSame(['bin', 'ice-batch'], $alice['caps']);
        $this->assertSame('udp-blocked', $alice['net']);
    }

    public function test_an_unrecognised_net_class_is_dropped_instead_of_stored(): void
    {
        $roster = $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-peer',
            'name' => 'Alice',
            'net' => 'moon-relay',
        ])->assertOk()->json('peers');

        $this->assertSame('', MeetPeer::query()->where('peer_id', 'alice-peer')->value('net'));
        $this->assertSame([], $roster);

        // A peer that reported nothing is distinct from one that probed and
        // could not classify itself, so the roster stays silent here.
        $bobRoster = $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'bob-peer',
            'name' => 'Bob',
        ])->json('peers');
        $this->assertArrayNotHasKey('net', collect($bobRoster)->firstWhere('id', 'alice-peer'));
    }

    public function test_join_advertises_the_configured_peer_ceiling(): void
    {
        $this->setAppSettings([SettingKeys::MEET_MAX_PEERS => '8']);

        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-peer',
            'name' => 'Alice',
        ])->assertOk()->assertJsonPath('rtc.limits.maxPeers', 8);
    }

    public function test_the_peer_ceiling_is_clamped_and_enforced(): void
    {
        $this->setAppSettings([SettingKeys::MEET_MAX_PEERS => '2']);
        $this->guestJoin('alice-peer', 'Alice');
        $this->withoutBearer()->guestJoin('bob-peer', 'Bob');

        $this->withoutBearer()->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'carol-peer',
            'name' => 'Carol',
        ])
            ->assertStatus(409)
            ->assertJson(['error' => 'room_full']);
    }

    public function test_a_guest_roster_never_leaks_usernames(): void
    {
        $token = $this->userBearerToken();
        $this->withBearer($token)->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'bob-peer',
            'name' => 'Bob',
        ])->assertOk();

        $guestRoster = $this->withoutBearer()->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'guest-peer',
            'name' => 'Guest',
        ])->json('peers');
        $this->assertSame([['id' => 'bob-peer', 'name' => 'Bob']], $guestRoster);

        $memberRoster = $this->withBearer($token)->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'bob-peer',
            'name' => 'Bob',
        ])->json('peers');
        $this->assertSame('Guest', collect($memberRoster)->firstWhere('id', 'guest-peer')['name']);
        $this->assertArrayNotHasKey('user', collect($memberRoster)->firstWhere('id', 'guest-peer'));
    }
}
