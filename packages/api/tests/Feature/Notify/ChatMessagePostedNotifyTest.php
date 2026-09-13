<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
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
        $this->assertSame('/meet', Notification::query()->where('principal', 'bob')->value('navigate'));
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
