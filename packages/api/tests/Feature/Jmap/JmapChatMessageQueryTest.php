<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\CalendarObject;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * ChatMessage/query (#1792): message ids scoped like ChatMessage/get, for
 * more messages than maxObjectsInGet.
 */
final class JmapChatMessageQueryTest extends WgwDatabaseTestCase
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
        // Users here share with each other; Epic #1915 only lets colleagues share.
        $this->seedSharedTeamForEveryone();
    }

    public function test_lists_more_messages_than_max_objects_in_get_across_pages(): void
    {
        $channelId = $this->createChannel('alice', 'Busy');
        $count = JmapCapabilities::MAX_OBJECTS_IN_GET + 5;
        $seeded = $this->seedMessages('alice', $channelId, $count);

        $this->jmap('alice', [['ChatMessage/get', ['accountId' => 'alice', 'ids' => null], 'c0']])
            ->assertJsonPath('methodResponses.0.1.type', 'requestTooLarge');

        $collected = [];
        $queryState = null;
        for ($position = 0; $position < $count; $position += 250) {
            $page = $this->jmap('alice', [
                ['ChatMessage/query', ['accountId' => 'alice', 'position' => $position, 'limit' => 250], 'c0'],
            ])->assertOk()->json('methodResponses.0.1');
            $this->assertSame($count, $page['total']);
            $this->assertFalse($page['canCalculateChanges']);
            $queryState ??= $page['queryState'];
            $this->assertSame($queryState, $page['queryState']);
            array_push($collected, ...$page['ids']);
        }
        $this->assertSame($seeded, $collected);

        $state = $this->jmap('alice', [['ChatMessage/get', ['accountId' => 'alice', 'ids' => []], 'c0']])
            ->assertOk()->json('methodResponses.0.1.state');
        $this->assertSame($state, $queryState);
    }

    public function test_scoped_like_chat_message_get_with_channel_filter(): void
    {
        $team = $this->createChannel('alice', 'Team');
        $private = $this->createChannel('alice', 'Private');
        $this->postMessage('alice', $team, $this->ulid('AA'), 'members only');
        $this->postMessage('alice', $team, $this->ulid('AB'), 'second');
        $this->postMessage('alice', $private, $this->ulid('AC'), 'alice only');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$team, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        $bob = $this->jmap('bob', [
            ['ChatMessage/query', ['accountId' => 'bob'], 'c0'],
            ['ChatMessage/get', ['accountId' => 'bob', 'ids' => null], 'c1'],
            ['ChatMessage/query', ['accountId' => 'bob', 'filter' => ['inChannel' => $private]], 'c2'],
        ])->assertOk();
        $ids = $bob->json('methodResponses.0.1.ids');
        $this->assertSame([$this->ulid('AA'), $this->ulid('AB')], $ids);
        $this->assertEqualsCanonicalizing($ids, array_column($bob->json('methodResponses.1.1.list'), 'id'));
        $this->assertSame($bob->json('methodResponses.1.1.state'), $bob->json('methodResponses.0.1.queryState'));
        $this->assertSame([], $bob->json('methodResponses.2.1.ids'), 'an unreachable channel matches nothing');

        $alice = $this->jmap('alice', [
            ['ChatMessage/query', ['accountId' => 'alice', 'filter' => ['inChannel' => $private]], 'c0'],
        ])->assertOk();
        $this->assertSame([$this->ulid('AC')], $alice->json('methodResponses.0.1.ids'));

        $carol = $this->jmap('carol', [['ChatMessage/query', ['accountId' => 'carol'], 'c0']])->assertOk();
        $this->assertSame([], $carol->json('methodResponses.0.1.ids'));
        $this->assertSame(0, $carol->json('methodResponses.0.1.total'));
    }

    public function test_rejects_sort_unknown_filters_and_query_changes(): void
    {
        $response = $this->jmap('alice', [
            ['ChatMessage/query', ['accountId' => 'alice', 'sort' => [['property' => 'createdAt']]], 'c0'],
            ['ChatMessage/query', ['accountId' => 'alice', 'filter' => ['authorId' => 'bob']], 'c1'],
            ['ChatMessage/query', ['accountId' => 'alice', 'filter' => ['inChannel' => '']], 'c2'],
            ['ChatMessage/queryChanges', ['accountId' => 'alice', 'sinceQueryState' => '0:'], 'c3'],
        ])->assertOk();

        foreach (['unsupportedSort', 'unsupportedFilter', 'invalidArguments', 'cannotCalculateChanges'] as $index => $type) {
            $response->assertJsonPath("methodResponses.{$index}.0", 'error');
            $response->assertJsonPath("methodResponses.{$index}.1.type", $type);
        }
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

    private function createChannel(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/chat/channels', ['name' => $name, 'kind' => 'channel'])
            ->assertCreated()
            ->json('id');
    }

    private function postMessage(string $username, string $channelId, string $messageId, string $body): void
    {
        $this->asUser($username)->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => $messageId, 'body' => $body,
        ])->assertCreated();
    }

    /**
     * Straight into calendarobjects; only the uid column matters to the query.
     *
     * @return list<string> the seeded message ids, in insert order
     */
    private function seedMessages(string $username, string $channelId, int $count): array
    {
        $instance = app(ChatChannelRepository::class)->findAccessibleChannel($username, $channelId);
        $this->assertNotNull($instance);
        $ids = [];
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $uid = sprintf('bulk-message-%04d', $i);
            $ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VJOURNAL\r\nUID:{$uid}\r\nDESCRIPTION:m{$i}\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
            $ids[] = $uid;
            $rows[] = [
                'calendardata' => $ics,
                'uri' => $uid.'.ics',
                'calendarid' => (int) $instance->calendarid,
                'lastmodified' => time(),
                'etag' => md5($ics),
                'size' => strlen($ics),
                'componenttype' => 'VJOURNAL',
                'uid' => $uid,
            ];
        }
        foreach (array_chunk($rows, 100) as $chunk) {
            CalendarObject::query()->insert($chunk);
        }

        return $ids;
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
