<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Vendor Meet chat envelope (#701 chunk D): ChatChannel/ChatMessage
 * get|changes over the chat VJOURNAL repositories. Mutations stay on REST
 * /chat/* — there are deliberately no /set methods. The client contract
 * under test is packages/apps/docs/meet-chat-client.md ("JMAP contract
 * assumptions").
 */
final class JmapChatMethodsTest extends WgwDatabaseTestCase
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

    public function test_session_advertises_vendor_chat_capability(): void
    {
        $session = $this->asUser('bob')->getJson('/api/v1/jmap/session')->assertOk()->json();

        $this->assertSame([], $session['capabilities'][JmapCapabilities::CHAT]);
        $chat = $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::CHAT];
        $this->assertSame(1, $chat['maxChannelsPerMessage']);
        $this->assertTrue($chat['mayCreateChannel']);
        $this->assertSame('bob', $session['primaryAccounts'][JmapCapabilities::CHAT]);
    }

    public function test_channel_get_and_changes_round_trip(): void
    {
        $channelId = $this->createChannel('alice', 'General', topic: 'Everything');

        $get = $this->jmap('alice', [
            ['ChatChannel/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk();
        $get->assertJsonPath('methodResponses.0.0', 'ChatChannel/get');
        $args = $get->json('methodResponses.0.1');
        $this->assertNotNull(JmapAccountStateCodec::decompose($args['state']));
        $this->assertSame([], $args['notFound']);
        $channel = collect($args['list'])->firstWhere('id', $channelId);
        $this->assertNotNull($channel);
        // REST ChatChannel schema, field-for-field (meet-chat-client.md §3).
        $this->assertSame('General', $channel['name']);
        $this->assertSame('channel', $channel['kind']);
        $this->assertSame('personal', $channel['scope']);
        $this->assertNull($channel['groupSlug']);
        $this->assertFalse($channel['isSharee']);
        $this->assertTrue($channel['myRights']['mayWriteAll']);
        $this->assertSame('Everything', $channel['topic']);
        $this->assertNull($channel['guestRoomCode']);
        $this->assertSame(1, $channel['memberCount']);
        $this->assertSame(0, $channel['unreadCount']);

        $changes = $this->jmap('alice', [
            ['ChatChannel/changes', ['accountId' => 'alice', 'sinceState' => '0:'], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($channelId, $changes['created']);
        $this->assertFalse($changes['hasMoreChanges']);
        $this->assertSame($args['state'], $changes['newState']);

        // Settled state: no changes, same token.
        $settled = $this->jmap('alice', [
            ['ChatChannel/changes', ['accountId' => 'alice', 'sinceState' => $changes['newState']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([], $settled['created']);
        $this->assertSame([], $settled['updated']);
        $this->assertSame([], $settled['destroyed']);

        // A message write bumps the channel collection token → updated.
        $this->postMessage('alice', $channelId, $this->ulid('AA'), 'hello');
        $afterMessage = $this->jmap('alice', [
            ['ChatChannel/changes', ['accountId' => 'alice', 'sinceState' => $changes['newState']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($channelId, $afterMessage['updated']);
    }

    public function test_message_get_and_changes_round_trip_with_tombstone_as_updated(): void
    {
        $channelId = $this->createChannel('alice', 'General');

        // ids: [] records the envelope state without listing (client init).
        $state = $this->jmap('alice', [
            ['ChatMessage/get', ['accountId' => 'alice', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $messageId = $this->ulid('AA');
        $this->postMessage('alice', $channelId, $messageId, 'hello **world**');

        $changes = $this->jmap('alice', [
            ['ChatMessage/changes', ['accountId' => 'alice', 'sinceState' => $state], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($messageId, $changes['created']);
        $this->assertFalse($changes['hasMoreChanges']);

        $got = $this->jmap('alice', [
            ['ChatMessage/get', ['accountId' => 'alice', 'ids' => [$messageId, 'missing-id']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame(['missing-id'], $got['notFound']);
        $message = $got['list'][0];
        // REST ChatMessage schema, field-for-field (meet-chat-client.md §3).
        $this->assertSame($messageId, $message['id']);
        $this->assertSame($channelId, $message['channelId']);
        $this->assertSame('alice', $message['authorId']);
        $this->assertSame('Alice', $message['authorName']);
        $this->assertSame('hello **world**', $message['body']);
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $message['createdAt']);
        $this->assertNull($message['editedAt']);
        $this->assertNull($message['deletedAt']);
        $this->assertNull($message['parentId']);
        $this->assertSame(0, $message['replyCount']);
        $this->assertSame([], $message['reactions']);
        $this->assertSame([], $message['mentions']);

        // Edit and reaction both surface as updated ids.
        $this->asUser('alice')->patchJson('/api/v1/chat/messages/'.$messageId, ['body' => 'edited'])->assertOk();
        $this->asUser('alice')->postJson('/api/v1/chat/messages/'.$messageId.'/reactions', ['emoji' => '👍'])->assertOk();
        $afterEdit = $this->jmap('alice', [
            ['ChatMessage/changes', ['accountId' => 'alice', 'sinceState' => $changes['newState']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($messageId, $afterEdit['updated']);
        $this->assertNotContains($messageId, $afterEdit['destroyed']);

        // Delete is a tombstone: arrives as updated (never destroyed), and
        // /get returns deletedAt set with an empty body.
        $this->asUser('alice')->deleteJson('/api/v1/chat/messages/'.$messageId)->assertOk();
        $afterDelete = $this->jmap('alice', [
            ['ChatMessage/changes', ['accountId' => 'alice', 'sinceState' => $afterEdit['newState']], 'c0'],
            ['ChatMessage/get', ['accountId' => 'alice', 'ids' => [$messageId]], 'c1'],
        ])->assertOk();
        $delta = $afterDelete->json('methodResponses.0.1');
        $this->assertContains($messageId, $delta['updated']);
        $this->assertNotContains($messageId, $delta['destroyed']);
        $tombstone = $afterDelete->json('methodResponses.1.1.list.0');
        $this->assertNotNull($tombstone['deletedAt']);
        $this->assertSame('', $tombstone['body']);
    }

    public function test_message_changes_pages_at_volume_with_honest_has_more_changes(): void
    {
        $channelId = $this->createChannel('alice', 'Busy');
        $state = $this->jmap('alice', [
            ['ChatMessage/get', ['accountId' => 'alice', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $suffixes = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AJ', 'AK', 'AM', 'AN'];
        $ids = [];
        foreach ($suffixes as $suffix) {
            $ids[] = $this->ulid($suffix);
            $this->postMessage('alice', $channelId, $this->ulid($suffix), 'message '.$suffix);
        }

        $collected = [];
        $pages = 0;
        $sinceState = $state;
        do {
            $delta = $this->jmap('alice', [
                ['ChatMessage/changes', ['accountId' => 'alice', 'sinceState' => $sinceState, 'maxChanges' => 5], 'c0'],
            ])->assertOk()->json('methodResponses.0.1');
            $this->assertLessThanOrEqual(5, count($delta['created']) + count($delta['updated']) + count($delta['destroyed']));
            foreach ($delta['created'] as $id) {
                $this->assertNotContains($id, $collected, 'paged ids must not repeat');
                $collected[] = $id;
            }
            $sinceState = $delta['newState'];
            $pages++;
        } while ($delta['hasMoreChanges'] && $pages < 10);

        $this->assertGreaterThan(1, $pages, 'twelve changes must not fit one five-change page');
        sort($ids);
        sort($collected);
        $this->assertSame($ids, $collected, 'paging must drain the feed without loss');

        // Drained: the final state is settled.
        $settled = $this->jmap('alice', [
            ['ChatMessage/changes', ['accountId' => 'alice', 'sinceState' => $sinceState], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([], $settled['created']);
        $this->assertFalse($settled['hasMoreChanges']);
    }

    public function test_malformed_since_state_is_cannot_calculate_changes(): void
    {
        foreach (['garbage', '2:only-one:1', '1:chat-x:not-digits'] as $bad) {
            foreach (['ChatChannel/changes', 'ChatMessage/changes'] as $method) {
                $this->jmap('alice', [
                    [$method, ['accountId' => 'alice', 'sinceState' => $bad], 'c0'],
                ])->assertOk()
                    ->assertJsonPath('methodResponses.0.0', 'error')
                    ->assertJsonPath('methodResponses.0.1.type', 'cannotCalculateChanges');
            }
        }

    }

    public function test_sharee_sees_shared_channel_and_non_member_sees_nothing(): void
    {
        $channelId = $this->createChannel('alice', 'Team');
        $messageId = $this->ulid('AA');
        $this->postMessage('alice', $channelId, $messageId, 'members only');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        // Sharee: channel and message are visible under the same ids.
        $bobChannels = $this->jmap('bob', [
            ['ChatChannel/get', ['accountId' => 'bob', 'ids' => [$channelId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame($channelId, $bobChannels['list'][0]['id']);
        $this->assertTrue($bobChannels['list'][0]['isSharee']);

        $bobMessages = $this->jmap('bob', [
            ['ChatMessage/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([$messageId], array_column($bobMessages['list'], 'id'));

        // Non-member: empty world, explicit ids come back notFound, and the
        // changes feed reports nothing from the initial state.
        $carolChannels = $this->jmap('carol', [
            ['ChatChannel/get', ['accountId' => 'carol', 'ids' => null], 'c0'],
            ['ChatMessage/get', ['accountId' => 'carol', 'ids' => [$messageId]], 'c1'],
            ['ChatChannel/changes', ['accountId' => 'carol', 'sinceState' => '0:'], 'c2'],
        ])->assertOk();
        $this->assertSame([], $carolChannels->json('methodResponses.0.1.list'));
        $this->assertSame([$messageId], $carolChannels->json('methodResponses.1.1.notFound'));
        $this->assertSame([], $carolChannels->json('methodResponses.2.1.created'));
    }

    public function test_newly_shared_channel_is_primed_without_replaying_history(): void
    {
        // Bob records his (empty) message state first.
        $bobState = $this->jmap('bob', [
            ['ChatMessage/get', ['accountId' => 'bob', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $channelId = $this->createChannel('alice', 'Late share');
        $oldMessageId = $this->ulid('AA');
        $this->postMessage('alice', $channelId, $oldMessageId, 'history before share');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        // The channel arrives as created via ChatChannel/changes — the cue
        // for the client's one-time REST history backfill.
        $channelDelta = $this->jmap('bob', [
            ['ChatChannel/changes', ['accountId' => 'bob', 'sinceState' => '0:'], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($channelId, $channelDelta['created']);

        // ChatMessage/changes primes the new channel without replaying its
        // pre-share history as created ids (meet-chat-client.md §4).
        $messageDelta = $this->jmap('bob', [
            ['ChatMessage/changes', ['accountId' => 'bob', 'sinceState' => $bobState], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertNotContains($oldMessageId, $messageDelta['created']);
        $this->assertFalse($messageDelta['hasMoreChanges']);

        // …but messages after the primed state flow incrementally.
        $newMessageId = $this->ulid('AB');
        $this->postMessage('alice', $channelId, $newMessageId, 'after share');
        $incremental = $this->jmap('bob', [
            ['ChatMessage/changes', ['accountId' => 'bob', 'sinceState' => $messageDelta['newState']], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($newMessageId, $incremental['created']);
        $this->assertNotContains($oldMessageId, $incremental['created']);
    }

    public function test_channel_delete_surfaces_as_channel_destroyed_and_message_state_drops_it(): void
    {
        $channelId = $this->createChannel('alice', 'Doomed');
        $this->postMessage('alice', $channelId, $this->ulid('AA'), 'gone soon');

        $channelState = $this->jmap('alice', [
            ['ChatChannel/get', ['accountId' => 'alice', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
        $messageState = $this->jmap('alice', [
            ['ChatMessage/get', ['accountId' => 'alice', 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');

        $this->asUser('alice')->deleteJson('/api/v1/chat/channels/'.$channelId)->assertOk();

        // Channel-level destroyed is the client's cue to prune the channel's
        // cached messages; ChatMessage/changes drops the channel silently.
        $channelDelta = $this->jmap('alice', [
            ['ChatChannel/changes', ['accountId' => 'alice', 'sinceState' => $channelState], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertContains($channelId, $channelDelta['destroyed']);

        $messageDelta = $this->jmap('alice', [
            ['ChatMessage/changes', ['accountId' => 'alice', 'sinceState' => $messageState], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
        $this->assertSame([], $messageDelta['created']);
        $this->assertSame([], $messageDelta['updated']);
        $this->assertSame([], $messageDelta['destroyed']);
        $this->assertSame('0:', $messageDelta['newState']);
    }

    public function test_get_all_messages_enumerates_every_accessible_channel(): void
    {
        $first = $this->createChannel('alice', 'One');
        $second = $this->createChannel('alice', 'Two');
        $this->postMessage('alice', $first, $this->ulid('AA'), 'in one');
        $this->postMessage('alice', $second, $this->ulid('AB'), 'in two');

        $got = $this->jmap('alice', [
            ['ChatMessage/get', ['accountId' => 'alice', 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $byChannel = array_column($got['list'], 'channelId', 'id');
        $this->assertSame($first, $byChannel[$this->ulid('AA')]);
        $this->assertSame($second, $byChannel[$this->ulid('AB')]);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CHAT],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function createChannel(string $username, string $name, ?string $topic = null): string
    {
        $payload = ['name' => $name, 'kind' => 'channel'];
        if ($topic !== null) {
            $payload['topic'] = $topic;
        }

        return (string) $this->asUser($username)
            ->postJson('/api/v1/chat/channels', $payload)
            ->assertCreated()
            ->json('id');
    }

    private function postMessage(string $username, string $channelId, string $messageId, string $body): void
    {
        $this->asUser($username)->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => $messageId, 'body' => $body,
        ])->assertCreated();
    }

    private function ulid(string $suffix): string
    {
        return self::ULID_PREFIX.$suffix;
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}
