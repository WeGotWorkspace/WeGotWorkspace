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
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
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

            /** @var array<string, int> */
            public array $statusByEndpoint = [];

            public function send(string $endpoint, string $p256dh, string $auth, string $payload, array $vapid): int
            {
                $this->sent[] = ['endpoint' => $endpoint, 'payload' => $payload];

                return $this->statusByEndpoint[$endpoint] ?? $this->status;
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
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        $this->assertSame(1, PushSubscription::query()->where('principal', 'alice')->count());
    }

    public function test_local_delivery_due_at_is_grace_window(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-13T12:00:00Z'));
        $this->seedSharedNotification('alice');
        $delivery = NotificationDelivery::query()->first();
        $this->assertNotNull($delivery);
        $this->assertSame(20, NotificationDelivery::LOCAL_ACK_GRACE_SECONDS);
        $this->assertGreaterThan(15, NotificationDelivery::LOCAL_ACK_GRACE_SECONDS);
        $this->assertTrue(
            $delivery->due_at->equalTo(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS)),
        );
        Carbon::setTestNow();
    }

    public function test_sweep_before_grace_does_not_send_vapid(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-13T12:00:00Z'));
        $this->seedSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        Carbon::setTestNow(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS - 1));
        app(VapidPushService::class)->sweepDue();
        $sender = app(WebPushSender::class);
        $this->assertSame([], $sender->sent);
        Carbon::setTestNow();
    }

    public function test_local_ack_in_window_skips_vapid(): void
    {
        $id = $this->seedDueSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/'.$id.'/local-ack')->assertOk();

        Carbon::setTestNow(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $sender = app(WebPushSender::class);
        $this->assertSame([], $sender->sent);
        Carbon::setTestNow();
    }

    public function test_no_ack_sends_vapid(): void
    {
        $this->seedDueSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        Carbon::setTestNow(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $sender = app(WebPushSender::class);
        $this->assertCount(1, $sender->sent);
        $decoded = json_decode($sender->sent[0]['payload'], true);
        $this->assertSame('A document was shared with you', $decoded['title']);
        $this->assertSame('/docs', $decoded['navigate']);
        $this->assertSame(8030, $decoded['web_push']);
        $this->assertSame('A document was shared with you', $decoded['notification']['title']);
        $this->assertStringEndsWith('/docs', $decoded['notification']['navigate']);
        $this->assertArrayHasKey('tag', $decoded);
        $this->assertTrue($decoded['renotify']);
        $this->assertSame(1, $decoded['app_badge']);
        Carbon::setTestNow();
    }

    public function test_failed_send_does_not_mark_sent_at(): void
    {
        $this->seedDueSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        $sender = app(WebPushSender::class);
        $sender->status = 0;
        Carbon::setTestNow(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $delivery = NotificationDelivery::query()->first();
        $this->assertNotNull($delivery);
        $this->assertNull($delivery->sent_at);
        Carbon::setTestNow();
    }

    public function test_410_unsubscribes(): void
    {
        $this->seedDueSharedNotification('alice');
        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/gone',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        $sender = app(WebPushSender::class);
        $sender->status = 410;
        Carbon::setTestNow(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $this->assertSame(0, PushSubscription::query()->count());
        Carbon::setTestNow();
    }

    public function test_vapid_payload_formats_from_structured_data(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-13T12:00:00Z'));
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: 'bob',
            domain: 'docs',
            action: 'shared',
            target: '/users/bob/notes.md',
            data: [
                'recipients' => ['alice'],
                'actor' => 'Bob',
                'path' => '/users/bob/notes.md',
                'fileName' => 'notes.md',
                'navigate' => '/docs',
                'tag' => 'docs.shared:fmt',
            ],
        ));
        $row = Notification::query()->where('principal', 'alice')->first();
        $this->assertNotNull($row);
        $this->assertIsArray($row->data);
        $this->assertSame('Bob', $row->data['actor'] ?? null);
        NotificationDelivery::query()->where('notification_id', $row->id)->update([
            'due_at' => Carbon::now()->subMinute(),
        ]);

        $token = $this->issueBearerTokenFor('alice');
        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/alice-fmt',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        // Stale denormalized columns must not win over structured data.
        $row->title = 'STALE TITLE';
        $row->body = 'STALE BODY';
        $row->save();

        app(VapidPushService::class)->sweepDue();
        $sender = app(WebPushSender::class);
        $this->assertCount(1, $sender->sent);
        $decoded = json_decode($sender->sent[0]['payload'], true);
        $this->assertSame('Bob shared notes.md with you', $decoded['title']);
        $this->assertSame('/users/bob/notes.md', $decoded['body']);
        $this->assertSame('Bob shared notes.md with you', $decoded['notification']['title']);
        Carbon::setTestNow();
    }

    public function test_subscribe_rejects_non_https_and_non_allowlisted_endpoints(): void
    {
        $token = $this->issueBearerTokenFor('alice');
        $keys = ['p256dh' => 'pub', 'auth' => 'secret'];

        foreach ([
            'http://127.0.0.1:9/push',
            'https://10.0.0.1/push',
            'https://169.254.169.254/latest/meta-data',
            'https://evil.example/push',
        ] as $endpoint) {
            $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
                'endpoint' => $endpoint,
                'keys' => $keys,
            ])->assertStatus(400);
        }

        $this->assertSame(0, PushSubscription::query()->count());
        $sender = app(WebPushSender::class);
        $this->assertSame([], $sender->sent);
    }

    public function test_subscribe_accepts_an_fcm_endpoint(): void
    {
        $token = $this->issueBearerTokenFor('alice');

        $this->withBearer($token)->postJson('/api/v1/notifications/push/subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/alice',
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ])->assertCreated();

        $this->assertSame(1, PushSubscription::query()->where('principal', 'alice')->count());
    }

    public function test_send_prunes_a_disallowed_existing_subscription(): void
    {
        $id = $this->seedDueSharedNotification('alice');
        $endpoint = 'https://evil.example/already-stored';
        PushSubscription::query()->create([
            'id' => (string) Str::ulid(),
            'principal' => 'alice',
            'endpoint' => $endpoint,
            'endpoint_hash' => hash('sha256', $endpoint),
            'p256dh' => 'pub',
            'auth' => 'secret',
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ]);

        $notification = Notification::query()->findOrFail($id);
        app(VapidPushService::class)->sendNotification($notification);

        $this->assertSame(0, PushSubscription::query()->count());
        $sender = app(WebPushSender::class);
        $this->assertSame([], $sender->sent);
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function failingStatuses(): iterable
    {
        yield 'timeout' => [0];
        yield 'rate limited' => [429];
        yield 'payload too large' => [413];
        yield 'server error' => [500];
        yield 'vapid mismatch' => [403];
    }

    #[DataProvider('failingStatuses')]
    public function test_failing_deliveries_for_one_principal_do_not_block_another(int $status): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-26T12:00:00Z'));
        $alice = 'https://fcm.googleapis.com/fcm/send/alice-broken';
        $bob = 'https://fcm.googleapis.com/fcm/send/bob';
        $this->subscribeDirect('alice', $alice);
        $this->subscribeDirect('bob', $bob);
        $sender = app(WebPushSender::class);
        $sender->statusByEndpoint[$alice] = $status;

        $this->seedLocalDeliveries('alice', 150, Carbon::now()->subMinutes(5));
        $this->seedLocalDeliveries('bob', 1, Carbon::now()->subMinute());

        $push = app(VapidPushService::class);
        $push->sweepDue();
        Carbon::setTestNow(Carbon::now()->addMinute());
        $push->sweepDue();

        $this->assertCount(1, $this->sentTo($bob));
        Carbon::setTestNow();
    }

    public function test_sweep_takes_oldest_due_deliveries_first(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-26T12:00:00Z'));
        $alice = 'https://fcm.googleapis.com/fcm/send/alice';
        $bob = 'https://fcm.googleapis.com/fcm/send/bob';
        $this->subscribeDirect('alice', $alice);
        $this->subscribeDirect('bob', $bob);

        $this->seedLocalDeliveries('alice', 100, Carbon::now()->subMinutes(2));
        $this->seedLocalDeliveries('bob', 1, Carbon::now()->subMinutes(10));

        app(VapidPushService::class)->sweepDue();

        $sender = app(WebPushSender::class);
        $this->assertSame($bob, $sender->sent[0]['endpoint'] ?? null);
        $this->assertCount(100, $sender->sent);
        Carbon::setTestNow();
    }

    public function test_failing_delivery_backs_off_and_is_given_up(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-10-26T12:00:00Z'));
        $endpoint = 'https://fcm.googleapis.com/fcm/send/alice-down';
        $this->subscribeDirect('alice', $endpoint);
        $sender = app(WebPushSender::class);
        $sender->status = 500;
        $this->seedLocalDeliveries('alice', 1, Carbon::now());

        $push = app(VapidPushService::class);
        $giveUpMinutes = intdiv(VapidPushService::GIVE_UP_AFTER_SECONDS, 60);
        for ($minute = 0; $minute <= $giveUpMinutes + 1; $minute++) {
            $push->sweepDue();
            Carbon::setTestNow(Carbon::now()->addMinute());
        }

        $attempts = count($sender->sent);
        $this->assertGreaterThan(1, $attempts);
        $this->assertLessThan(10, $attempts);
        $this->assertSame(0, NotificationDelivery::query()->count());
        $this->assertSame(1, PushSubscription::query()->count());
        Carbon::setTestNow();
    }

    /**
     * @return iterable<string, array{int}>
     */
    public static function permanentRejections(): iterable
    {
        yield 'bad request' => [400];
        yield 'vapid mismatch' => [403];
        yield 'not found' => [404];
        yield 'gone' => [410];
    }

    #[DataProvider('permanentRejections')]
    public function test_permanent_rejection_prunes_subscription(int $status): void
    {
        $this->seedDueSharedNotification('alice');
        $this->subscribeDirect('alice', 'https://fcm.googleapis.com/fcm/send/alice-rejected');
        $sender = app(WebPushSender::class);
        $sender->status = $status;

        app(VapidPushService::class)->sweepDue();

        $this->assertSame(0, PushSubscription::query()->count());
        $delivery = NotificationDelivery::query()->first();
        $this->assertNotNull($delivery);
        $this->assertNotNull($delivery->sent_at);
    }

    public function test_transient_failure_keeps_subscription(): void
    {
        $this->seedDueSharedNotification('alice');
        $this->subscribeDirect('alice', 'https://fcm.googleapis.com/fcm/send/alice-busy');
        $sender = app(WebPushSender::class);
        $sender->status = 429;

        app(VapidPushService::class)->sweepDue();

        $this->assertSame(1, PushSubscription::query()->count());
    }

    private function subscribeDirect(string $principal, string $endpoint): void
    {
        app(VapidPushService::class)->subscribe($principal, [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ]);
    }

    private function seedLocalDeliveries(string $principal, int $count, Carbon $createdAt): void
    {
        for ($i = 0; $i < $count; $i++) {
            $id = (string) Str::ulid();
            Notification::query()->create([
                'id' => $id,
                'principal' => $principal,
                'event_id' => 'evt-'.$id,
                'domain' => 'docs',
                'action' => 'shared',
                'title' => 'A document was shared with you',
                'navigate' => '/docs',
                'dedupe_key' => 'docs.shared:'.$id,
                'created_at' => $createdAt,
            ]);
            NotificationDelivery::query()->create([
                'id' => (string) Str::ulid(),
                'notification_id' => $id,
                'principal' => $principal,
                'channel' => NotificationDelivery::CHANNEL_LOCAL,
                'due_at' => $createdAt->copy()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS),
                'created_at' => $createdAt,
            ]);
        }
    }

    /**
     * @return list<array{endpoint: string, payload: string}>
     */
    private function sentTo(string $endpoint): array
    {
        $sender = app(WebPushSender::class);

        return array_values(array_filter(
            $sender->sent,
            static fn (array $row): bool => $row['endpoint'] === $endpoint,
        ));
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

        return (string) $row->id;
    }

    private function seedDueSharedNotification(string $principal): string
    {
        $id = $this->seedSharedNotification($principal);
        NotificationDelivery::query()->where('notification_id', $id)->update([
            'due_at' => Carbon::now()->subMinute(),
        ]);

        return $id;
    }
}
