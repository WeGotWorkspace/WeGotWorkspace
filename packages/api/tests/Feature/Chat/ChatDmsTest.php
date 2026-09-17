<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use App\Services\Chat\ChatCollectionUris;
use App\Services\Jmap\JmapCapabilities;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * DM provisioning (Epic #701, chunk G): POST /chat/dms finds-or-creates the
 * deterministic 2-person dm- collection, shared to both principals with write
 * access through the standard sharing machinery. DM channels then flow through
 * the existing channel/message endpoints unchanged — except that they are
 * immutable via the generic channel endpoints (no rename, re-share, transfer,
 * or delete).
 */
final class ChatDmsTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    /** Valid Crockford ULID prefix; append two Crockford chars for ordering. */
    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3ZB';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
    }

    public function test_open_dm_provisions_channel_shared_to_both_sides(): void
    {
        $dm = $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json();

        // Deterministic order-independent hash uri: dm- plus 40 lowercase hex.
        $this->assertSame(ChatCollectionUris::dmUri('alice', 'bob'), $dm['id']);
        $this->assertMatchesRegularExpression('/^dm-[0-9a-f]{40}$/', $dm['id']);
        $this->assertSame('dm', $dm['kind']);
        $this->assertSame('bob', $dm['dmPeer']);
        $this->assertSame('Bob', $dm['name']);
        $this->assertSame(2, $dm['memberCount']);
        $this->assertFalse($dm['isSharee']);
        $this->assertTrue($dm['myRights']['mayWriteAll']);

        // The peer sees the same channel id with write access, named after alice.
        $peerView = $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$dm['id'])->assertOk()->json();
        $this->assertSame($dm['id'], $peerView['id']);
        $this->assertSame('dm', $peerView['kind']);
        $this->assertSame('alice', $peerView['dmPeer']);
        $this->assertSame('Alice', $peerView['name']);
        $this->assertTrue($peerView['isSharee']);
        $this->assertTrue($peerView['myRights']['mayWriteAll']);
        $this->assertSame(2, $peerView['memberCount']);

        // Both channel lists carry the dm row; outsiders never see it.
        $this->assertSame([$dm['id']], array_column($this->asUser('alice')->getJson('/api/v1/chat/channels')->json('list'), 'id'));
        $this->assertSame([$dm['id']], array_column($this->asUser('bob')->getJson('/api/v1/chat/channels')->json('list'), 'id'));
        $this->asUser('carol')->getJson('/api/v1/chat/channels/'.$dm['id'])->assertNotFound();
    }

    public function test_open_dm_is_idempotent_from_both_directions(): void
    {
        $first = $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');

        $replayed = $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');
        $fromPeer = $this->asUser('bob')->postJson('/api/v1/chat/dms', ['principal' => 'alice'])
            ->assertOk()->json('id');

        $this->assertSame($first, $replayed);
        $this->assertSame($first, $fromPeer);

        // Exactly one collection exists — no duplicate provisioning.
        $this->assertCount(1, $this->asUser('alice')->getJson('/api/v1/chat/channels')->json('list'));
        $this->assertCount(1, $this->asUser('bob')->getJson('/api/v1/chat/channels')->json('list'));

        // Distinct pairs get distinct collections.
        $other = $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'carol'])
            ->assertOk()->json('id');
        $this->assertNotSame($first, $other);
    }

    public function test_open_dm_rejects_self_groups_and_unknown_principals(): void
    {
        $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'alice'])
            ->assertStatus(400);
        $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'ALICE'])
            ->assertStatus(400);

        $this->seedWgwGroup('principals/groups/devs', 'Devs');
        $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'groups/devs'])
            ->assertStatus(400);

        // Guests/external identities have no principal row — not a DM target.
        $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'ghost'])
            ->assertStatus(400);
        $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => ''])
            ->assertStatus(400);
        $this->asUser('alice')->postJson('/api/v1/chat/dms', [])
            ->assertStatus(400);

        // Nothing was provisioned by the rejected calls.
        $this->assertSame([], $this->asUser('alice')->getJson('/api/v1/chat/channels')->json('list'));
    }

    public function test_dm_channels_are_immutable_via_generic_channel_endpoints(): void
    {
        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');

        // No rename/recolor/topic — for the provisioning owner or the peer.
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$dmId, ['name' => 'Bobby'])->assertForbidden();
        $this->asUser('bob')->patchJson('/api/v1/chat/channels/'.$dmId, ['name' => 'Al'])->assertForbidden();
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$dmId, ['topic' => 'secret'])->assertForbidden();

        // No further sharing and no owner transfer.
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$dmId, [
            'shareWith' => ['carol' => ['mayWriteAll' => true]],
        ])->assertForbidden();
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$dmId, ['groupSlug' => 'devs'])->assertForbidden();

        // No delete — not even the sharee-dismissal path channels get.
        $this->asUser('alice')->deleteJson('/api/v1/chat/channels/'.$dmId)->assertForbidden();
        $this->asUser('bob')->deleteJson('/api/v1/chat/channels/'.$dmId)->assertForbidden();

        // Still fully intact for both members afterwards.
        $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$dmId)->assertOk();
        $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$dmId)->assertOk();

        // dm channels cannot be minted through the generic create either.
        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Fake dm', 'kind' => 'dm',
        ])->assertStatus(400);
        $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Shadow', 'kind' => 'channel', 'id' => 'dm-0123456789abcdef0123456789abcdef01234567',
        ])->assertStatus(400);
    }

    public function test_dm_messages_read_markers_and_unread_flow_through_existing_endpoints(): void
    {
        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');
        $messagesPath = '/api/v1/chat/channels/'.$dmId.'/messages';

        // Both members write through the standard message endpoint.
        $fromAlice = $this->asUser('alice')->postJson($messagesPath, [
            'id' => $this->ulid('AA'), 'body' => 'hi bob',
        ])->assertCreated()->json();
        $this->asUser('bob')->postJson($messagesPath, [
            'id' => $this->ulid('AB'), 'body' => 'hi alice',
        ])->assertCreated();

        $list = $this->asUser('bob')->getJson($messagesPath)->assertOk()->json('list');
        $this->assertSame([$this->ulid('AA'), $this->ulid('AB')], array_column($list, 'id'));

        // Edit stays author-only; reactions are open to both members.
        $this->asUser('alice')->patchJson('/api/v1/chat/messages/'.$fromAlice['id'], ['body' => 'hi bob!'])
            ->assertOk()->assertJsonPath('body', 'hi bob!');
        $this->asUser('bob')->patchJson('/api/v1/chat/messages/'.$fromAlice['id'], ['body' => 'hijack'])
            ->assertForbidden();
        $this->asUser('bob')->postJson('/api/v1/chat/messages/'.$fromAlice['id'].'/reactions', ['emoji' => '👍'])
            ->assertOk();

        // Unread math: own messages never count; the read marker clears the badge.
        $bobChannel = $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$dmId)->assertOk()->json();
        $this->assertSame(1, $bobChannel['unreadCount']);
        $edited = collect($this->asUser('bob')->getJson($messagesPath)->json('list'))
            ->firstWhere('id', $fromAlice['id']);
        $this->asUser('bob')->putJson('/api/v1/chat/channels/'.$dmId.'/read-marker', [
            'lastReadTs' => $edited['createdAt'],
            'lastReadUid' => $edited['id'],
        ])->assertOk();
        $this->assertSame(0, $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$dmId)->json('unreadCount'));

        // Non-members can neither read nor write the DM.
        $this->asUser('carol')->getJson($messagesPath)->assertNotFound();
        $this->asUser('carol')->postJson($messagesPath, [
            'id' => $this->ulid('AC'), 'body' => 'intrusion',
        ])->assertNotFound();
    }

    public function test_dm_flows_through_changes_feed_and_jmap_unchanged(): void
    {
        $primedAlice = (string) $this->asUser('alice')->getJson('/api/v1/chat/channels/changes')->assertOk()->json('newState');
        $primedBob = (string) $this->asUser('bob')->getJson('/api/v1/chat/channels/changes')->assertOk()->json('newState');

        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', ['principal' => 'bob'])
            ->assertOk()->json('id');

        // The dm surfaces as `created` on both members' channel changes feeds.
        $this->assertSame([$dmId], $this->asUser('alice')
            ->getJson('/api/v1/chat/channels/changes?since='.urlencode($primedAlice))->assertOk()->json('created'));
        $this->assertSame([$dmId], $this->asUser('bob')
            ->getJson('/api/v1/chat/channels/changes?since='.urlencode($primedBob))->assertOk()->json('created'));

        // JMAP ChatChannel/get mirrors the REST row for both members, dmPeer included.
        foreach (['alice' => 'bob', 'bob' => 'alice'] as $member => $peer) {
            $get = $this->asUser($member)->postJson('/api/v1/jmap', [
                'using' => [JmapCapabilities::CORE, JmapCapabilities::CHAT],
                'methodCalls' => [['ChatChannel/get', ['accountId' => $member, 'ids' => [$dmId]], 'c0']],
            ])->assertOk();
            $row = collect($get->json('methodResponses.0.1.list'))->firstWhere('id', $dmId);
            $this->assertNotNull($row);
            $this->assertSame('dm', $row['kind']);
            $this->assertSame($peer, $row['dmPeer']);
        }
    }

    private function ulid(string $suffix): string
    {
        return self::ULID_PREFIX.strtoupper($suffix);
    }

    /** @var array<string, string> */
    private array $bearerTokens = [];

    /**
     * @return static
     */
    private function asUser(string $username)
    {
        $this->bearerTokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->bearerTokens[$username]);
    }
}
