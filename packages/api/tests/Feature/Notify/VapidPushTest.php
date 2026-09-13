<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Models\Notification;
use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Services\Notify\VapidPushService;
use App\Services\Notify\WebPushSender;
use Illuminate\Support\Carbon;
use Tests\Support\WgwDatabaseTestCase;

final class VapidPushTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->app->instance(WebPushSender::class, new class implements WebPushSender
        {
            /** @var list<array{endpoint: string, payload: string}> */
            public array $sent = [];

            public int $status = 201;

            public function send(string $endpoint, string $p256dh, string $auth, string $payload, array $vapid): int
            {
                $this->sent[] = ['endpoint' => $endpoint, 'payload' => $payload];

                return $this->status;
            }
        });
        $this->app->forgetInstance(VapidPushService::class);
    }

    public function test_subscribe_and_public_key(): void
    {
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->getJson('/api/v1/notifications/push/vapid-public-key')
            ->assertOk()
            ->assertJsonStructure(['publicKey']);

        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://push.example/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        $this->assertSame(1, PushSubscription::query()->where('principal', 'alice')->count());
    }

    public function test_local_ack_in_window_skips_vapid(): void
    {
        $id = $this->seedSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/'.$id.'/local-ack')->assertOk();

        Carbon::setTestNow(Carbon::now()->addMinutes(2));
        app(VapidPushService::class)->sweepDue();
        $sender = app(WebPushSender::class);
        $this->assertSame([], $sender->sent);
        Carbon::setTestNow();
    }

    public function test_no_ack_sends_vapid(): void
    {
        $this->seedSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://push.example/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        Carbon::setTestNow(Carbon::now()->addMinutes(2));
        app(VapidPushService::class)->sweepDue();
        $sender = app(WebPushSender::class);
        $this->assertCount(1, $sender->sent);
        $decoded = json_decode($sender->sent[0]['payload'], true);
        $this->assertSame('A document was shared with you', $decoded['title']);
        $this->assertArrayHasKey('navigate', $decoded);
        $this->assertArrayHasKey('tag', $decoded);
        $this->assertTrue($decoded['renotify']);
        $this->assertSame(1, $decoded['app_badge']);
        Carbon::setTestNow();
    }

    public function test_410_unsubscribes(): void
    {
        $this->seedSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://push.example/gone',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        $sender = app(WebPushSender::class);
        $sender->status = 410;
        Carbon::setTestNow(Carbon::now()->addMinutes(2));
        app(VapidPushService::class)->sweepDue();
        $this->assertSame(0, PushSubscription::query()->count());
        Carbon::setTestNow();
    }

    private function seedSharedNotification(string $principal): string
    {
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: 'bob',
            domain: 'docs',
            action: 'shared',
            target: '/users/bob/doc.md',
            data: [
                'recipients' => [$principal],
                'title' => 'A document was shared with you',
                'navigate' => '/docs',
            ],
        ));
        $row = Notification::query()->where('principal', $principal)->first();
        $this->assertNotNull($row);
        NotificationDelivery::query()->where('notification_id', $row->id)->update([
            'due_at' => Carbon::now()->subMinute(),
        ]);

        return (string) $row->id;
    }
}
