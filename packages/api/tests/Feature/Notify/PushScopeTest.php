<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Services\Notify\VapidPushService;
use App\Services\Notify\WebPushSender;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Web Push per installed app (#1606): a subscription carries the scopes of the
 * apps that posted it, and the sweep only sends a notification to the
 * subscriptions whose scope covers the path the notification opens.
 */
final class PushScopeTest extends WgwDatabaseTestCase
{
    private const SUITE = 'https://fcm.googleapis.com/fcm/send/alice-suite';

    private const DOCS = 'https://fcm.googleapis.com/fcm/send/alice-docs';

    private const CALENDAR = 'https://fcm.googleapis.com/fcm/send/alice-calendar';

    private const MEET = 'https://fcm.googleapis.com/fcm/send/alice-meet';

    private const DRIVE = 'https://fcm.googleapis.com/fcm/send/alice-drive';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->app->instance(WebPushSender::class, new class implements WebPushSender
        {
            /** @var list<array{endpoint: string, payload: string}> */
            public array $sent = [];

            /** @var array<string, int> push service answer per endpoint; 201 otherwise */
            public array $statuses = [];

            public function send(string $endpoint, string $p256dh, string $auth, string $payload, array $vapid): int
            {
                $this->sent[] = ['endpoint' => $endpoint, 'payload' => $payload];

                return $this->statuses[$endpoint] ?? 201;
            }
        });
        $this->app->forgetInstance(VapidPushService::class);
    }

    public function test_a_subscription_posted_without_scope_receives_everything(): void
    {
        $this->subscribe(self::SUITE)
            ->assertCreated()
            ->assertJsonPath('scopes', ['/']);

        // No scope is "unknown": it receives everything until an app names its scope.
        $this->assertNull($this->storedScopes(self::SUITE));
        app(VapidPushService::class)->sendNotification($this->notification('tasks', 'status_changed', '/tasks'));
        $this->assertSame([self::SUITE], $this->sentEndpoints());
    }

    public function test_a_row_stored_before_scopes_existed_takes_the_first_scope_posted(): void
    {
        DB::connection('wgw')->table('push_subscriptions')->insert([
            'id' => (string) Str::ulid(),
            'principal' => 'alice',
            'endpoint' => self::DOCS,
            'endpoint_hash' => hash('sha256', self::DOCS),
            'p256dh' => 'pub',
            'auth' => 'secret',
            'created_at' => Carbon::now(),
        ]);
        $this->assertNull($this->storedScopes(self::DOCS));
        $service = app(VapidPushService::class);
        $service->sendNotification($this->notification('tasks', 'status_changed', '/tasks'));
        $this->assertSame([self::DOCS], $this->sentEndpoints());

        // The installed Docs app opens after the upgrade: unknown becomes /docs, not "/ wins".
        $this->subscribe(self::DOCS, '/docs')->assertCreated()->assertJsonPath('scopes', ['/docs']);
        $this->assertSame(['/docs'], $this->storedScopes(self::DOCS));

        $this->sender()->sent = [];
        $service->sendNotification($this->notification('tasks', 'status_changed', '/tasks'));
        $this->assertSame([], $this->sentEndpoints());

        // An old page that posts without a scope does not widen it again.
        $this->subscribe(self::DOCS)->assertCreated()->assertJsonPath('scopes', ['/docs']);
        $this->assertSame(['/docs'], $this->storedScopes(self::DOCS));
    }

    public function test_a_subscription_stores_the_scope_it_was_posted_with(): void
    {
        $this->subscribe(self::DOCS, '/docs')
            ->assertCreated()
            ->assertJsonPath('scopes', ['/docs']);

        $this->assertSame(['/docs'], $this->storedScopes(self::DOCS));
    }

    public function test_one_endpoint_posted_from_several_scopes_keeps_all_and_root_wins(): void
    {
        $this->subscribe(self::SUITE, '/docs')->assertCreated();
        $this->subscribe(self::SUITE, '/calendar')->assertCreated();
        $this->assertSame(['/calendar', '/docs'], $this->storedScopes(self::SUITE));

        $this->subscribe(self::SUITE, '/')->assertCreated()->assertJsonPath('scopes', ['/']);
        $this->assertSame(['/'], $this->storedScopes(self::SUITE));

        // A narrower app posting later does not narrow a suite subscription.
        $this->subscribe(self::SUITE, '/docs')->assertCreated()->assertJsonPath('scopes', ['/']);
        $this->assertSame(['/'], $this->storedScopes(self::SUITE));
        $this->assertSame(1, PushSubscription::query()->where('principal', 'alice')->count());
    }

    public function test_a_scope_that_is_not_an_app_manifest_id_is_rejected(): void
    {
        foreach (['/evil', 'docs', '/docs/', '//docs', ''] as $scope) {
            $this->subscribe(self::DOCS, $scope)->assertStatus(400);
        }
        $this->assertSame(0, PushSubscription::query()->count());
    }

    public function test_the_sweep_only_sends_to_subscriptions_whose_scope_matches(): void
    {
        $this->subscribe(self::SUITE, '/')->assertCreated();
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        $this->subscribe(self::CALENDAR, '/calendar')->assertCreated();
        $this->dueNotification('docs', 'shared', '/docs?file=report.md');

        app(VapidPushService::class)->sweepDue();

        $this->assertEqualsCanonicalizing([self::SUITE, self::DOCS], $this->sentEndpoints());
    }

    public function test_each_domain_reaches_its_own_app_and_the_suite(): void
    {
        $this->subscribe(self::SUITE, '/')->assertCreated();
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        $this->subscribe(self::CALENDAR, '/calendar')->assertCreated();
        $this->subscribe(self::MEET, '/meet')->assertCreated();
        $service = app(VapidPushService::class);

        $cases = [
            ['docs', 'thread_activity', '/docs', [self::SUITE, self::DOCS]],
            ['calendar', 'invite', '/calendar', [self::SUITE, self::CALENDAR]],
            ['tasks', 'status_changed', '/tasks', [self::SUITE]],
            ['notes', 'shared', '/notes', [self::SUITE]],
            ['chat', 'mentioned', '/meet/channels/general', [self::SUITE, self::MEET]],
            ['meet', 'started', '/meet/meetings/standup', [self::SUITE, self::MEET]],
            ['contacts', 'shared', '/contacts', [self::SUITE]],
        ];
        foreach ($cases as [$domain, $action, $navigate, $expected]) {
            $this->sender()->sent = [];
            $service->sendNotification($this->notification($domain, $action, $navigate));
            $this->assertEqualsCanonicalizing($expected, $this->sentEndpoints(), "{$domain}.{$action}");
        }
    }

    public function test_a_delivery_with_no_matching_subscription_is_not_retried(): void
    {
        $this->subscribe(self::CALENDAR, '/calendar')->assertCreated();
        $id = $this->dueNotification('docs', 'shared', '/docs');

        app(VapidPushService::class)->sweepDue();

        $this->assertSame([], $this->sentEndpoints());
        $delivery = NotificationDelivery::query()->where('notification_id', $id)->first();
        $this->assertNotNull($delivery);
        $this->assertNotNull($delivery->sent_at);
    }

    public function test_a_notification_goes_to_the_app_it_opens_in(): void
    {
        $this->subscribe(self::SUITE, '/')->assertCreated();
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        $this->subscribe(self::DRIVE, '/drive')->assertCreated();
        // A shared folder is a Docs-domain notification that opens Drive.
        app(VapidPushService::class)->sendNotification($this->notification('docs', 'shared', '/drive'));

        $this->assertEqualsCanonicalizing([self::SUITE, self::DRIVE], $this->sentEndpoints());
        $drive = $this->payloadFor(self::DRIVE);
        $this->assertSame('/drive', $drive['scope']);
        $this->assertSame('/drive', $drive['navigate']);
        $this->assertStringEndsWith('/drive', $drive['notification']['navigate']);
        $suite = $this->payloadFor(self::SUITE);
        $this->assertSame('/', $suite['scope']);
        $this->assertSame('/drive', $suite['navigate']);
    }

    public function test_the_domain_decides_when_the_notification_opens_the_suite_start(): void
    {
        $this->subscribe(self::SUITE, '/')->assertCreated();
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        $this->subscribe(self::CALENDAR, '/calendar')->assertCreated();
        $service = app(VapidPushService::class);

        foreach (['/', ''] as $navigate) {
            $this->sender()->sent = [];
            $service->sendNotification($this->notification('docs', 'shared', $navigate));

            $this->assertEqualsCanonicalizing([self::SUITE, self::DOCS], $this->sentEndpoints(), "navigate '{$navigate}'");
            // The Docs app opens its own start, not the suite home.
            $docs = $this->payloadFor(self::DOCS);
            $this->assertSame('/docs', $docs['scope']);
            $this->assertSame('/docs', $docs['navigate']);
            $this->assertSame('/', $this->payloadFor(self::SUITE)['navigate']);
        }
    }

    public function test_a_notification_that_opens_outside_every_app_only_reaches_the_suite(): void
    {
        $this->subscribe(self::SUITE, '/')->assertCreated();
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        app(VapidPushService::class)->sendNotification($this->notification('docs', 'shared', '/share/abc'));

        $this->assertSame([self::SUITE], $this->sentEndpoints());
    }

    public function test_dot_segments_in_navigate_cannot_reach_another_app(): void
    {
        $this->subscribe(self::SUITE, '/')->assertCreated();
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        $this->subscribe(self::CALENDAR, '/calendar')->assertCreated();
        $service = app(VapidPushService::class);

        foreach (['/docs/../calendar', '/docs/%2e%2e/calendar', '/docs/%2E%2E/./calendar'] as $navigate) {
            $this->sender()->sent = [];
            $service->sendNotification($this->notification('docs', 'shared', $navigate));

            // The browser opens /calendar, so that is the app that gets it.
            $this->assertEqualsCanonicalizing([self::SUITE, self::CALENDAR], $this->sentEndpoints(), $navigate);
            $this->assertSame('/calendar', $this->payloadFor(self::CALENDAR)['navigate'], $navigate);
            $this->assertSame('/calendar', $this->payloadFor(self::SUITE)['navigate'], $navigate);
        }
    }

    public function test_a_scoped_subscription_that_fails_is_retried_not_marked_sent(): void
    {
        $this->subscribe(self::DOCS, '/docs')->assertCreated();
        $this->subscribe(self::CALENDAR, '/calendar')->assertCreated();
        $this->sender()->statuses[self::DOCS] = 503;
        $id = $this->dueNotification('docs', 'shared', '/docs?file=report.md');

        app(VapidPushService::class)->sweepDue();

        $this->assertSame([self::DOCS], $this->sentEndpoints());
        $delivery = NotificationDelivery::query()->where('notification_id', $id)->first();
        $this->assertNotNull($delivery);
        $this->assertNull($delivery->sent_at);
        $this->assertTrue($delivery->due_at->isFuture());
    }

    public function test_an_in_scope_navigate_is_kept_for_a_single_app_subscription(): void
    {
        $this->subscribe(self::MEET, '/meet')->assertCreated();
        app(VapidPushService::class)->sendNotification(
            $this->notification('chat', 'mentioned', '/meet/channels/general'),
        );

        $payload = $this->payloadFor(self::MEET);
        $this->assertSame('/meet', $payload['scope']);
        $this->assertSame('/meet/channels/general', $payload['navigate']);
    }

    private function subscribe(string $endpoint, ?string $scope = null): TestResponse
    {
        $body = [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'pub', 'auth' => 'secret'],
        ];
        if ($scope !== null) {
            $body['scope'] = $scope;
        }

        return $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/notifications/push/subscriptions', $body);
    }

    /**
     * @return list<string>|null null while the scope is unknown
     */
    private function storedScopes(string $endpoint): ?array
    {
        $row = PushSubscription::query()->where('endpoint_hash', hash('sha256', $endpoint))->first();
        $this->assertNotNull($row);

        return $row->scopeList();
    }

    private function notification(string $domain, string $action, string $navigate): Notification
    {
        return Notification::query()->create([
            'id' => (string) Str::ulid(),
            'principal' => 'alice',
            'event_id' => (string) Str::ulid(),
            'domain' => $domain,
            'action' => $action,
            'title' => 'Something happened',
            'body' => null,
            'navigate' => $navigate,
            'tag' => null,
            'dedupe_key' => $domain.'.'.$action.':'.Str::random(8),
            'created_at' => Carbon::now(),
        ]);
    }

    private function dueNotification(string $domain, string $action, string $navigate): string
    {
        $notification = $this->notification($domain, $action, $navigate);
        NotificationDelivery::query()->create([
            'id' => (string) Str::ulid(),
            'notification_id' => $notification->id,
            'principal' => 'alice',
            'channel' => NotificationDelivery::CHANNEL_LOCAL,
            'due_at' => Carbon::now()->subMinute(),
            'created_at' => Carbon::now()->subMinutes(2),
        ]);

        return (string) $notification->id;
    }

    /**
     * @return object{sent: list<array{endpoint: string, payload: string}>, statuses: array<string, int>}
     */
    private function sender(): object
    {
        /** @var object{sent: list<array{endpoint: string, payload: string}>, statuses: array<string, int>} */
        return app(WebPushSender::class);
    }

    /**
     * @return list<string>
     */
    private function sentEndpoints(): array
    {
        return array_map(static fn (array $row): string => $row['endpoint'], $this->sender()->sent);
    }

    /**
     * @return array<string, mixed>
     */
    private function payloadFor(string $endpoint): array
    {
        foreach ($this->sender()->sent as $row) {
            if ($row['endpoint'] === $endpoint) {
                /** @var array<string, mixed> */
                return json_decode($row['payload'], true, 512, JSON_THROW_ON_ERROR);
            }
        }
        $this->fail("No push sent to {$endpoint}");
    }
}
