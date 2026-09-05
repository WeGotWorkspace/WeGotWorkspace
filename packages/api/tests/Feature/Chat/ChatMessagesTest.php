<?php

declare(strict_types=1);

namespace Tests\Feature\Chat;

use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class ChatMessagesTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    /** Valid Crockford ULID prefix; append two Crockford chars for ordering. */
    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3ZB';

    private string $channelId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $this->channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$this->channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();
    }

    public function test_send_and_list_round_trip(): void
    {
        $id = $this->ulid('AA');
        $created = $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $id, 'body' => 'hello **world**',
        ])->assertCreated()->json();

        $this->assertSame($id, $created['id']);
        $this->assertSame($this->channelId, $created['channelId']);
        $this->assertSame('alice', $created['authorId']);
        $this->assertSame('Alice', $created['authorName']);
        $this->assertSame('hello **world**', $created['body']);
        $this->assertNotSame('', $created['createdAt']);
        $this->assertNull($created['editedAt']);
        $this->assertNull($created['deletedAt']);
        $this->assertNull($created['parentId']);
        $this->assertSame(0, $created['replyCount']);
        $this->assertSame([], $created['reactions']);

        // The sharee reads the same message under the same channel id.
        $list = $this->asUser('bob')->getJson($this->messagesPath())->assertOk()->json();
        $this->assertFalse($list['hasMore']);
        $this->assertCount(1, $list['list']);
        $this->assertSame($id, $list['list'][0]['id']);

        // Lowercase ULIDs normalize to the same message id.
        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => strtolower($this->ulid('AB')), 'body' => 'second',
        ])->assertCreated()->assertJsonPath('id', $this->ulid('AB'));
    }

    public function test_create_is_idempotent_on_client_ulid(): void
    {
        $id = $this->ulid('AA');
        $first = $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $id, 'body' => 'original body',
        ])->assertCreated()->json();

        // Replaying the same ULID (offline outbox retry) returns the existing
        // message — the body of the replay is ignored, nothing is duplicated.
        $replay = $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $id, 'body' => 'retry body that must not win',
        ])->assertCreated()->json();

        $this->assertSame($first['id'], $replay['id']);
        $this->assertSame('original body', $replay['body']);
        $this->assertCount(1, $this->asUser('alice')->getJson($this->messagesPath())->json('list'));

        // The same ULID in a DIFFERENT channel is a conflict, not idempotency.
        $otherChannel = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Other', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->postJson('/api/v1/chat/channels/'.$otherChannel.'/messages', [
            'id' => $id, 'body' => 'smuggled',
        ])->assertStatus(409);
    }

    public function test_create_validation_matrix(): void
    {
        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => 'not-a-ulid', 'body' => 'x',
        ])->assertStatus(400);

        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $this->ulid('AA'), 'body' => str_repeat('x', 65_537),
        ])->assertStatus(413);

        // parentId must reference a message in the same channel.
        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $this->ulid('AB'), 'body' => 'reply', 'parentId' => $this->ulid('ZZ'),
        ])->assertStatus(400);

        // Non-member cannot address the channel at all; read-only sharee cannot post.
        $this->asUser('carol')->postJson($this->messagesPath(), [
            'id' => $this->ulid('AC'), 'body' => 'intrusion',
        ])->assertNotFound();
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$this->channelId, [
            'shareWith' => ['carol' => ['mayReadItems' => true]],
        ])->assertOk();
        $this->asUser('carol')->postJson($this->messagesPath(), [
            'id' => $this->ulid('AD'), 'body' => 'read-only post',
        ])->assertForbidden();
    }

    public function test_edit_and_delete_are_strictly_author_only(): void
    {
        $id = $this->ulid('AA');
        $this->asUser('bob')->postJson($this->messagesPath(), [
            'id' => $id, 'body' => 'bob wrote this',
        ])->assertCreated();

        // Even the channel OWNER cannot edit or delete someone else's message.
        $this->asUser('alice')->patchJson('/api/v1/chat/messages/'.$id, ['body' => 'hijacked'])
            ->assertForbidden();
        $this->asUser('alice')->deleteJson('/api/v1/chat/messages/'.$id)
            ->assertForbidden();
        $this->asUser('carol')->patchJson('/api/v1/chat/messages/'.$id, ['body' => 'x'])
            ->assertNotFound();

        $edited = $this->asUser('bob')->patchJson('/api/v1/chat/messages/'.$id, [
            'body' => 'bob fixed a typo',
        ])->assertOk()->json();
        $this->assertSame('bob fixed a typo', $edited['body']);
        $this->assertNotNull($edited['editedAt']);

        $this->asUser('bob')->deleteJson('/api/v1/chat/messages/'.$id)
            ->assertOk()->assertJsonPath('ok', true);
        // Idempotent tombstone: repeating the delete stays ok.
        $this->asUser('bob')->deleteJson('/api/v1/chat/messages/'.$id)
            ->assertOk()->assertJsonPath('ok', true);

        // The tombstone keeps the timeline slot: body cleared, deletedAt set.
        $tombstone = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $id);
        $this->assertSame('', $tombstone['body']);
        $this->assertNotNull($tombstone['deletedAt']);

        // Editing a tombstone is refused.
        $this->asUser('bob')->patchJson('/api/v1/chat/messages/'.$id, ['body' => 'resurrect'])
            ->assertStatus(400);
    }

    public function test_reaction_toggles_from_multiple_users_merge_like_an_or_set(): void
    {
        $id = $this->ulid('AA');
        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $id, 'body' => 'react here',
        ])->assertCreated();

        $reactionsPath = '/api/v1/chat/messages/'.$id.'/reactions';
        $this->asUser('alice')->postJson($reactionsPath, ['emoji' => '👍'])->assertOk();
        $this->asUser('bob')->postJson($reactionsPath, ['emoji' => '👍'])->assertOk();
        $this->asUser('bob')->postJson($reactionsPath, ['emoji' => '🎉'])->assertOk();

        $message = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $id);
        $this->assertSame([
            ['emoji' => '👍', 'authors' => ['alice', 'bob']],
            ['emoji' => '🎉', 'authors' => ['bob']],
        ], $message['reactions']);
        // Reactions are not author edits: no editedAt, SEQUENCE untouched.
        $this->assertNull($message['editedAt']);

        // Toggling off removes only the caller; empty entries disappear.
        $this->asUser('alice')->postJson($reactionsPath, ['emoji' => '👍'])->assertOk();
        $this->asUser('bob')->postJson($reactionsPath, ['emoji' => '🎉'])->assertOk();
        $message = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $id);
        $this->assertSame([['emoji' => '👍', 'authors' => ['bob']]], $message['reactions']);

        // An author edit AFTER reactions keeps them and only then bumps state.
        $this->asUser('alice')->patchJson('/api/v1/chat/messages/'.$id, ['body' => 'edited'])
            ->assertOk()
            ->assertJsonPath('reactions.0.emoji', '👍');

        // Non-members cannot react.
        $this->asUser('carol')->postJson($reactionsPath, ['emoji' => '👀'])->assertNotFound();
    }

    public function test_every_mutation_surfaces_in_the_changes_feed(): void
    {
        $changesPath = '/api/v1/chat/messages/changes?channelId='.$this->channelId;
        $initial = $this->asUser('alice')->getJson($changesPath)->assertOk()->json();
        $this->assertFalse($initial['hasMoreChanges']);

        $id = $this->ulid('AA');
        $this->asUser('alice')->postJson($this->messagesPath(), ['id' => $id, 'body' => 'v1'])->assertCreated();

        $afterCreate = $this->asUser('alice')->getJson($changesPath.'&since='.$initial['newState'])->assertOk()->json();
        $this->assertSame([$id], $afterCreate['created']);

        $this->asUser('alice')->patchJson('/api/v1/chat/messages/'.$id, ['body' => 'v2'])->assertOk();
        $afterEdit = $this->asUser('alice')->getJson($changesPath.'&since='.$afterCreate['newState'])->assertOk()->json();
        $this->assertSame([$id], $afterEdit['updated']);

        $this->asUser('bob')->postJson('/api/v1/chat/messages/'.$id.'/reactions', ['emoji' => '👍'])->assertOk();
        $afterReaction = $this->asUser('alice')->getJson($changesPath.'&since='.$afterEdit['newState'])->assertOk()->json();
        $this->assertSame([$id], $afterReaction['updated']);

        // The delete tombstone travels as a modification, NOT a destroy — the
        // object stays for thread integrity; clients render the tombstone.
        $this->asUser('alice')->deleteJson('/api/v1/chat/messages/'.$id)->assertOk();
        $afterDelete = $this->asUser('alice')->getJson($changesPath.'&since='.$afterReaction['newState'])->assertOk()->json();
        $this->assertSame([$id], $afterDelete['updated']);
        $this->assertSame([], $afterDelete['destroyed']);

        // channelId is required; foreign channels 404; bad tokens 400.
        $this->asUser('alice')->getJson('/api/v1/chat/messages/changes')->assertStatus(400);
        $this->asUser('carol')->getJson($changesPath)->assertNotFound();
        $this->asUser('alice')->getJson($changesPath.'&since=garbage')->assertStatus(400);
    }

    public function test_changes_feed_pages_honestly_at_volume(): void
    {
        $baseline = $this->asUser('alice')->getJson(
            '/api/v1/chat/messages/changes?channelId='.$this->channelId,
        )->assertOk()->json('newState');

        // CHANGES_PAGE_SIZE is 200: 201 writes forces a second page.
        for ($i = 0; $i < 201; $i++) {
            $suffix = sprintf('%s%s', self::CROCKFORD[intdiv($i, 32)], self::CROCKFORD[$i % 32]);
            $this->asUser('alice')->postJson($this->messagesPath(), [
                'id' => $this->ulid($suffix), 'body' => 'msg '.$i,
            ])->assertCreated();
        }

        $page1 = $this->asUser('alice')->getJson(
            '/api/v1/chat/messages/changes?channelId='.$this->channelId.'&since='.$baseline,
        )->assertOk()->json();
        $this->assertTrue($page1['hasMoreChanges']);
        $this->assertCount(200, $page1['created']);

        $page2 = $this->asUser('alice')->getJson(
            '/api/v1/chat/messages/changes?channelId='.$this->channelId.'&since='.$page1['newState'],
        )->assertOk()->json();
        $this->assertFalse($page2['hasMoreChanges']);
        $this->assertCount(1, $page2['created']);
        $this->assertSame([], array_intersect($page1['created'], $page2['created']));
    }

    private const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    public function test_cursor_paging_orders_by_created_ts_with_ulid_tiebreak(): void
    {
        // Same-second creates: the ULID is the tiebreak, and since the server
        // assigns created_ts these all sort deterministically by uid.
        $ids = [];
        foreach (['AA', 'AB', 'AC', 'AD', 'AE'] as $suffix) {
            $ids[] = $this->ulid($suffix);
            $this->asUser('alice')->postJson($this->messagesPath(), [
                'id' => $this->ulid($suffix), 'body' => 'msg '.$suffix,
            ])->assertCreated();
        }

        $window = $this->asUser('alice')->getJson($this->messagesPath().'?limit=3')->assertOk()->json();
        $this->assertTrue($window['hasMore']);
        $this->assertSame(array_slice($ids, 2), array_column($window['list'], 'id'));

        $since = $this->asUser('alice')->getJson($this->messagesPath().'?since='.$ids[1].'&limit=2')->assertOk()->json();
        $this->assertSame([$ids[2], $ids[3]], array_column($since['list'], 'id'));
        $this->assertTrue($since['hasMore']);

        $before = $this->asUser('alice')->getJson($this->messagesPath().'?before='.$ids[3].'&limit=2')->assertOk()->json();
        $this->assertSame([$ids[1], $ids[2]], array_column($before['list'], 'id'));
        $this->assertTrue($before['hasMore']);

        $beforeAll = $this->asUser('alice')->getJson($this->messagesPath().'?before='.$ids[1].'&limit=5')->assertOk()->json();
        $this->assertSame([$ids[0]], array_column($beforeAll['list'], 'id'));
        $this->assertFalse($beforeAll['hasMore']);

        $this->asUser('alice')->getJson($this->messagesPath().'?since='.$ids[0].'&before='.$ids[3])->assertStatus(400);
        $this->asUser('alice')->getJson($this->messagesPath().'?since='.$this->ulid('ZZ'))->assertStatus(400);
    }

    public function test_read_marker_and_unread_math(): void
    {
        // bob posts three messages in ULID order; alice posts one of her own.
        $bobIds = [];
        foreach (['AA', 'AB', 'AC'] as $suffix) {
            $bobIds[] = $this->ulid($suffix);
            $this->asUser('bob')->postJson($this->messagesPath(), [
                'id' => $this->ulid($suffix), 'body' => 'from bob '.$suffix,
            ])->assertCreated();
        }
        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $this->ulid('AZ'), 'body' => 'from alice',
        ])->assertCreated();

        // Without a marker every foreign message is unread; own ones never count.
        $channel = $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$this->channelId)->assertOk()->json();
        $this->assertSame(3, $channel['unreadCount']);
        $bobView = $this->asUser('bob')->getJson('/api/v1/chat/channels/'.$this->channelId)->assertOk()->json();
        $this->assertSame(1, $bobView['unreadCount']);

        // Marker at bob's SECOND message: with equal timestamps the ULID is
        // the tiebreak, so only the third message stays unread.
        $second = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $bobIds[1]);
        $this->asUser('alice')->putJson('/api/v1/chat/channels/'.$this->channelId.'/read-marker', [
            'lastReadTs' => $second['createdAt'],
            'lastReadUid' => $second['id'],
        ])->assertOk()->assertJsonPath('ok', true);

        $channel = $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$this->channelId)->assertOk()->json();
        $this->assertSame(1, $channel['unreadCount']);

        // Marker at the last message: fully read.
        $third = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $bobIds[2]);
        $this->asUser('alice')->putJson('/api/v1/chat/channels/'.$this->channelId.'/read-marker', [
            'lastReadTs' => $third['createdAt'],
            'lastReadUid' => $third['id'],
        ])->assertOk();
        $channel = $this->asUser('alice')->getJson('/api/v1/chat/channels/'.$this->channelId)->assertOk()->json();
        $this->assertSame(0, $channel['unreadCount']);

        // Non-members cannot place markers.
        $this->asUser('carol')->putJson('/api/v1/chat/channels/'.$this->channelId.'/read-marker', [
            'lastReadTs' => $third['createdAt'],
            'lastReadUid' => $third['id'],
        ])->assertNotFound();
    }

    public function test_thread_reply_count_follows_live_replies(): void
    {
        $parentId = $this->ulid('AA');
        $this->asUser('alice')->postJson($this->messagesPath(), [
            'id' => $parentId, 'body' => 'thread root',
        ])->assertCreated();

        $replyIds = [];
        foreach (['AB', 'AC'] as $suffix) {
            $replyIds[] = $this->ulid($suffix);
            $this->asUser('bob')->postJson($this->messagesPath(), [
                'id' => $this->ulid($suffix), 'body' => 'reply '.$suffix, 'parentId' => $parentId,
            ])->assertCreated()->assertJsonPath('parentId', $parentId);
        }

        $parent = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $parentId);
        $this->assertSame(2, $parent['replyCount']);

        // Tombstoned replies stop counting; the thread slot itself remains.
        $this->asUser('bob')->deleteJson('/api/v1/chat/messages/'.$replyIds[0])->assertOk();
        $parent = collect($this->asUser('alice')->getJson($this->messagesPath())->json('list'))
            ->firstWhere('id', $parentId);
        $this->assertSame(1, $parent['replyCount']);
    }

    private function messagesPath(): string
    {
        return '/api/v1/chat/channels/'.$this->channelId.'/messages';
    }

    private function ulid(string $suffix): string
    {
        return self::ULID_PREFIX.strtoupper($suffix);
    }

    /** @var array<string, string> */
    private array $bearerTokens = [];

    /**
     * One login per user per test: repeated logins are slow and trip the
     * login rate limiter in high-volume tests (JWTs stay valid throughout).
     */
    private function asUser(string $username)
    {
        $this->bearerTokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->bearerTokens[$username]);
    }
}
