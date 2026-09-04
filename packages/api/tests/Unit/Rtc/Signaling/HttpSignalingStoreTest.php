<?php

declare(strict_types=1);

namespace Tests\Unit\Rtc\Signaling;

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
                ['id' => 'aaaaaaaaaaaaaaaa', 'name' => 'Alice', 'user' => 'alice'],
                ['id' => 'bbbbbbbbbbbbbbbb', 'name' => 'Bob', 'user' => 'bob'],
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
            [['id' => 'bbbbbbbbbbbbbbbb', 'name' => 'Bob', 'user' => 'bob']],
            $store->peerList('room-a', 'cccccccccccccccc'),
        );
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
