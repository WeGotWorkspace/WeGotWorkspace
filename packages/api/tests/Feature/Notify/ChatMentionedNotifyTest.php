<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Services\Notify\ChatMentionedNotify;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class ChatMentionedNotifyTest extends WgwDatabaseTestCase
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

    public function test_mentioned_user_gets_mentioned_only_not_message_posted(): void
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

        $created = $this->asUser('alice')->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => $this->ulid('AA'),
            'body' => 'hey @bob please look',
            'mentions' => [
                ['id' => 'bob', 'displayName' => 'Bob'],
            ],
        ])->assertCreated()->json();

        $this->assertSame([['id' => 'bob', 'displayName' => 'Bob']], $created['mentions']);

        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', ChatMentionedNotify::ACTION)->count());
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('action', 'message_posted')->count());
        $this->assertSame(1, Notification::query()->where('principal', 'carol')->where('action', 'message_posted')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'carol')->where('action', ChatMentionedNotify::ACTION)->count());
        $this->assertSame(0, Notification::query()->where('principal', 'alice')->count());

        $bob = Notification::query()->where('principal', 'bob')->first();
        $this->assertNotNull($bob);
        $this->assertSame('Alice mentioned you in #general', $bob->title);
    }

    public function test_unknown_mention_token_ignored(): void
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'General', 'kind' => 'channel',
        ])->assertCreated()->json('id');
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, [
            'shareWith' => ['bob' => ['mayWriteAll' => true]],
        ])->assertOk();

        $this->asUser('alice')->postJson('/api/v1/chat/channels/'.$channelId.'/messages', [
            'id' => $this->ulid('AB'),
            'body' => 'hey @nobody',
            'mentions' => [
                ['id' => 'nobody', 'displayName' => 'Nobody'],
            ],
        ])->assertCreated();

        $this->assertSame(0, Notification::query()->where('action', ChatMentionedNotify::ACTION)->count());
        $this->assertSame(1, Notification::query()->where('principal', 'bob')->where('action', 'message_posted')->count());
    }

    private function ulid(string $suffix): string
    {
        return self::ULID_PREFIX.$suffix;
    }

    private function asUser(string $username)
    {
        if (! isset($this->bearerTokens[$username])) {
            $this->bearerTokens[$username] = $this->issueBearerTokenFor($username);
        }

        return $this->withBearer($this->bearerTokens[$username]);
    }
}
