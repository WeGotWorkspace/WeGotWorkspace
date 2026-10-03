<?php

declare(strict_types=1);

namespace Tests\Unit\Rtc\Signaling;

use App\Models\CollabPeer;
use App\Services\Rtc\Signaling\HttpSignalingStore;
use App\Services\Rtc\Signaling\RtcSignalingException;
use App\Services\Rtc\Signaling\RtcSignalingPolicy;
use Illuminate\Support\Facades\Schema;
use Tests\Support\WgwTestDatabase;
use Tests\TestCase;

final class HttpSignalingStoreTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        WgwTestDatabase::configureConnection('sqlite');
        Schema::connection('wgw')->dropIfExists('meet_messages');
        Schema::connection('wgw')->dropIfExists('meet_peers');
        Schema::connection('wgw')->dropIfExists('collab_messages');
        Schema::connection('wgw')->dropIfExists('collab_peers');
        Schema::connection('wgw')->create('meet_peers', function ($table): void {
            $table->string('room');
            $table->string('peer_id');
            $table->string('name');
            $table->string('owner_user')->default('');
            $table->string('browser_id')->default('');
            $table->string('caps')->default('');
            $table->string('net')->default('');
            $table->integer('seen_at');
            $table->unique(['room', 'peer_id']);
        });
        Schema::connection('wgw')->create('meet_messages', function ($table): void {
            $table->increments('id');
            $table->string('room');
            $table->string('from_peer');
            $table->string('to_peer');
            $table->string('type');
            $table->text('payload');
            $table->integer('created_at');
        });
        Schema::connection('wgw')->create('collab_peers', function ($table): void {
            $table->string('room');
            $table->string('peer_id');
            $table->string('name');
            $table->string('owner_user')->default('');
            $table->string('browser_id')->default('');
            $table->string('caps')->default('');
            $table->string('net')->default('');
            $table->string('access', 8)->default('read');
            $table->integer('seen_at');
            $table->unique(['room', 'peer_id']);
        });
        Schema::connection('wgw')->create('collab_messages', function ($table): void {
            $table->increments('id');
            $table->string('room');
            $table->string('from_peer');
            $table->string('to_peer');
            $table->string('type');
            $table->text('payload');
            $table->integer('created_at');
        });
    }

    public function test_collab_poll_uses_since_cursor(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::collab());
        $now = time();
        $store->upsertPeer('room-a', 'aaaaaaaaaaaaaaaa', 'Alice', 'u:alice', $now);
        $store->upsertPeer('room-a', 'bbbbbbbbbbbbbbbb', 'Bob', 'u:bob', $now);

        $store->send('room-a', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'offer', ['sdp' => 'v=0']);
        $first = $store->poll('room-a', 'bbbbbbbbbbbbbbbb', 0);
        $this->assertCount(1, $first['messages']);
        $this->assertSame(1, $first['messages'][0]['id']);

        $second = $store->poll('room-a', 'bbbbbbbbbbbbbbbb', $first['messages'][0]['id']);
        $this->assertSame([], $second['messages']);
    }

    public function test_delete_owned_peers_except_leaves_the_replacement(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::collab());
        $now = time();
        $store->upsertPeer('room-a', 'aaaaaaaaaaaaaaaa', 'Alice', 'u:alice', $now);
        $store->upsertPeer('room-a', 'bbbbbbbbbbbbbbbb', 'Bob', 'u:bob', $now);

        $deleted = $store->deleteOwnedPeersExcept('room-a', 'u:alice');
        $this->assertSame([], $deleted);
        $this->assertSame(
            [
                ['id' => 'aaaaaaaaaaaaaaaa', 'name' => 'Alice', 'user' => 'alice', 'access' => 'read'],
                ['id' => 'bbbbbbbbbbbbbbbb', 'name' => 'Bob', 'user' => 'bob', 'access' => 'read'],
            ],
            $store->peerList('room-a', 'cccccccccccccccc'),
        );
    }

    public function test_delete_owned_peers_except_evicts_after_join_grace(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::collab());
        $old = time() - 20;
        $store->upsertPeer('room-a', 'aaaaaaaaaaaaaaaa', 'Alice', 'u:alice', $old);
        $store->upsertPeer('room-a', 'bbbbbbbbbbbbbbbb', 'Bob', 'u:bob', time());

        $deleted = $store->deleteOwnedPeersExcept('room-a', 'u:alice');
        $this->assertSame(['aaaaaaaaaaaaaaaa'], $deleted);
        $this->assertSame(
            [['id' => 'bbbbbbbbbbbbbbbb', 'name' => 'Bob', 'user' => 'bob', 'access' => 'read']],
            $store->peerList('room-a', 'cccccccccccccccc'),
        );
    }

    public function test_delete_peers_for_browser_evicts_same_browser_only(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());
        $now = time();
        $store->upsertPeer('room-a', 'alice-old', 'Alice', 'u:alice', $now, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        $store->upsertPeer('room-a', 'alice-phone', 'Alice', 'u:alice', $now, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
        $store->upsertPeer('room-a', 'bob-peer', 'Bob', 'u:bob', $now, 'cccccccccccccccccccccccccccccccc');

        $deleted = $store->deletePeersForBrowser('room-a', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'alice-new');
        $this->assertSame(['alice-old'], $deleted);
        $this->assertSame(
            [
                ['id' => 'alice-phone', 'name' => 'Alice'],
                ['id' => 'bob-peer', 'name' => 'Bob'],
            ],
            $store->peerList('room-a', 'alice-new'),
        );
    }

    public function test_roster_carries_caps_access_and_net(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::collab());
        $store->upsertPeer('room-a', 'aaaaaaaaaaaaaaaa', 'Alice', 'u:alice', time(), null, [
            'caps' => 'bin,yjs-http',
            'net' => 'symmetric',
            'access' => 'write',
        ]);

        $this->assertSame(
            [[
                'id' => 'aaaaaaaaaaaaaaaa',
                'name' => 'Alice',
                'user' => 'alice',
                'access' => 'write',
                'caps' => ['bin', 'yjs-http'],
                'net' => 'symmetric',
            ]],
            $store->peerList('room-a', 'bbbbbbbbbbbbbbbb'),
        );
    }

    public function test_roster_omits_owner_when_the_caller_is_not_authenticated(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());
        $now = time();
        $store->upsertPeer('room-a', 'alice-peer', 'Alice', 'u:alice', $now);
        $store->upsertPeer('room-a', 'guest-peer', 'Guest', 'g:'.str_repeat('a', 32), $now);

        $this->assertSame(
            [
                ['id' => 'alice-peer', 'name' => 'Alice', 'user' => 'alice'],
                ['id' => 'guest-peer', 'name' => 'Guest'],
            ],
            $store->peerList('room-a', 'self-peer', true),
        );
        $this->assertSame(
            [
                ['id' => 'alice-peer', 'name' => 'Alice'],
                ['id' => 'guest-peer', 'name' => 'Guest'],
            ],
            $store->peerList('room-a', 'self-peer', false),
        );
    }

    public function test_access_falls_back_to_read_for_a_row_join_never_wrote(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::collab());
        CollabPeer::query()->insert([
            'room' => 'room-a',
            'peer_id' => 'aaaaaaaaaaaaaaaa',
            'name' => 'Alice',
            'owner_user' => 'u:alice',
            'seen_at' => time(),
        ]);

        $this->assertSame('read', $store->peerList('room-a', 'other')[0]['access']);
    }

    public function test_peer_id_of_another_actor_is_refused(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());
        $store->upsertPeer('room-a', 'peer-1234', 'Alice', 'u:alice', time());

        // Same owner may re-join its own peer id (second tab, reload).
        $store->assertPeerIdFree('room-a', 'peer-1234', 'u:alice');
        $store->assertPeerIdFree('room-a', 'peer-free', 'u:bob');

        $this->expectException(RtcSignalingException::class);
        $this->expectExceptionMessage('peer_id_taken');

        $store->assertPeerIdFree('room-a', 'peer-1234', 'u:bob');
    }

    public function test_server_inserted_message_bypasses_the_client_type_allowlist(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());
        $now = time();
        $store->upsertPeer('room-a', 'peer-from', 'Alice', 'u:alice', $now);
        $store->upsertPeer('room-a', 'peer-to', 'Bob', 'u:bob', $now);

        $store->insertServerMessage('room-a', 'peer-from', 'peer-to', 'relay-hint', ['reason' => 'failed']);

        $messages = $store->poll('room-a', 'peer-to')['messages'];
        $this->assertSame('relay-hint', $messages[0]['type']);
        $this->assertSame('peer-from', $messages[0]['from']);

        $this->expectException(RtcSignalingException::class);
        $this->expectExceptionMessage('bad_type');
        $store->send('room-a', 'peer-from', 'peer-to', 'relay-hint', ['reason' => 'failed']);
    }

    public function test_sampled_prune_runs_every_request_only_when_configured_to(): void
    {
        config(['wgw.rtc.prune_one_in' => 1]);
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());
        $store->upsertPeer('room-a', 'ghost-peer', 'Ghost', 'u:alice', time() - 120);

        $this->assertSame(1, $store->countStalePeers());

        $store->pruneOldRowsSampled();

        $this->assertSame(0, $store->countPeers('room-a'));
    }

    public function test_sampled_prune_leaves_most_requests_alone(): void
    {
        config(['wgw.rtc.prune_one_in' => 1_000_000]);
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());
        $store->upsertPeer('room-a', 'ghost-peer', 'Ghost', 'u:alice', time() - 120);

        for ($request = 0; $request < 20; $request++) {
            $store->pruneOldRowsSampled();
        }

        $this->assertSame(1, $store->countPeers('room-a'));
    }

    public function test_peer_timeouts_match_the_signaling_contract(): void
    {
        $this->assertSame(60, RtcSignalingPolicy::meet()->peerTimeoutSeconds);
        $this->assertSame(90, RtcSignalingPolicy::collab()->peerTimeoutSeconds);
    }

    public function test_missing_peer_returns_unknown_peer_for_recovery(): void
    {
        $store = new HttpSignalingStore(RtcSignalingPolicy::meet());

        $this->expectException(RtcSignalingException::class);
        $this->expectExceptionMessage('unknown_peer');

        $store->assertPeerOwnedByActor('room-a', 'peer-1234', 'guest:abc');
    }

    protected function tearDown(): void
    {
        Schema::connection('wgw')->dropIfExists('meet_messages');
        Schema::connection('wgw')->dropIfExists('meet_peers');
        Schema::connection('wgw')->dropIfExists('collab_messages');
        Schema::connection('wgw')->dropIfExists('collab_peers');
        parent::tearDown();
    }
}
