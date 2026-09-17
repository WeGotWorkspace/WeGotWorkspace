<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Chat\ChatMessagePostedNotify;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class ChatMessagePostedNotifyTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private const ULID_PREFIX = '01J6Y6M0R2V9GKJ4W1T8Q3ZB';

    /** @var array<string, string> */
    private array $bearerTokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');
    }

    public function test_channel_notifies_n_minus_one_and_skips_author(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => [
                'bob' => ['mayWriteAll' => true],
                'carol' => ['mayWriteAll' => true],
            ],
        ])->assertOk();

        $this->asUser('alice')->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => $this->ulid('AA'),
            'body' => 'hello team',
        ])->assertCreated();

        $this->assertSame(0, Notification::query()->where('principal', 'alice')->where('action', 'message_posted')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'message_posted')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'message_posted')->count());
        $this->assertSame(2, Notification::query()->where('action', 'message_posted')->count());
        $bob = Notification::query()->where('principal', 'bob')->first();
        $this->assertNotNull($bob);
        $this->assertSame('Alice sent a message in #general', $bob->title);
        $this->assertSame('hello team', $bob->body);
        $this->assertIsArray($bob->data);
        $this->assertSame('Alice', $bob->data['actor'] ?? null);
        $this->assertSame('hello team', $bob->data['snippet'] ?? null);
        $this->assertSame(
            ChatMessagePostedNotify::navigate($channelId, 'channel', 'alice'),
            $bob->navigate,
        );
        $this->assertStringStartsWith('/meet/channels/', (string) $bob->navigate);
        $this->assertNotSame('/meet', $bob->navigate);

        $inbox = $this->asUser('bob')->getJson('/api/v1/notifications')->assertOk()->json();
        $this->assertSame(1, $inbox['unreadCount']);
        $this->assertCount(1, $inbox['list']);
        $this->assertSame('chat', $inbox['list'][0]['domain']);
        $this->assertSame('message_posted', $inbox['list'][0]['action']);
        $this->assertSame('Alice sent a message in #general', $inbox['list'][0]['title']);
        $this->assertSame('hello team', $inbox['list'][0]['body']);
        $this->assertIsArray($inbox['list'][0]['data'] ?? null);
        $this->assertSame('Alice', $inbox['list'][0]['data']['actor'] ?? null);
    }

    public function test_dm_notifies_peer_only(): void
    {
        $dmId = (string) $this->asUser('alice')->postJson('/api/v1/chat/dms', [
            'principal' => 'bob',
        ])->assertOk()->json('id');

        $this->asUser('alice')->postJson('/api/v1/chat/channels/'.$dmId.'/messages', [
            'id' => $this->ulid('AB'),
            'body' => 'ping',
        ])->assertCreated();

        $this->assertSame(1, Notification::query()->where('action', 'message_posted')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'message_posted')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'alice')->where('action', 'message_posted')->count());
        $bob = Notification::query()->where('principal', 'bob')->first();
        $this->assertNotNull($bob);
        $this->assertSame('Alice sent you a direct message', $bob->title);
        $this->assertSame('ping', $bob->body);
        $this->assertSame('/meet/dms/alice', $bob->navigate);

        $inbox = $this->asUser('bob')->getJson('/api/v1/notifications')->assertOk()->json();
        $this->assertSame(1, $inbox['unreadCount']);
        $this->assertSame('Alice sent you a direct message', $inbox['list'][0]['title']);
        $this->assertSame('/meet/dms/alice', $inbox['list'][0]['navigate']);
    }

    private function asUser(string $username)
    {
        $this->bearerTokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->bearerTokens[$username]);
    }

    private function ulid(string $suffix): string
    {
        return self::ULID_PREFIX.$suffix;
    }
}
