<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Models\Notification;
use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Services\Notify\MinishlinkWebPushSender;
use App\Services\Notify\PushFailureTally;
use App\Services\Notify\VapidPushService;
use App\Services\Notify\WebPushSender;
use GuzzleHttp\Psr7\Response;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Tests\Support\FakesPushService;
use Tests\Support\WgwDatabaseTestCase;

final class VapidSweepFailureLogTest extends WgwDatabaseTestCase
{
    use FakesPushService;

    private int $pushStatus = 201;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->app->instance(WebPushSender::class, new MinishlinkWebPushSender(
            $this->app->make(PushFailureTally::class),
            $this->pushServiceAnswering(fn (): Response => new Response($this->pushStatus, [], '{"reason":"BadJwtToken"}')),
        ));
        $this->app->forgetInstance(VapidPushService::class);
        $this->captureLogs();
    }

    public function test_sweep_logs_summary_when_a_send_is_rejected(): void
    {
        $this->pushStatus = 429;
        $this->seedDueNotificationWithSubscription('alice');
        $this->app->make(PushFailureTally::class)->record('stale.example', 500);

        $this->assertSame(0, Artisan::call('wgw:notify:vapid-sweep'));
        $this->assertStringContainsString('1 push send(s) failed', Artisan::output());

        $rejected = $this->logsNamed('vapid_send_rejected');
        $this->assertCount(1, $rejected);
        $this->assertSame(429, $rejected[0]->context['status']);

        $summary = $this->logsNamed('vapid_sweep_failures');
        $this->assertCount(1, $summary);
        $this->assertSame('warning', $summary[0]->level);
        $this->assertSame([
            'sent' => 0,
            'failed' => 1,
            'by_status' => [429 => 1],
            'by_host' => ['fcm.googleapis.com' => 1],
        ], $summary[0]->context);
        $this->assertStringNotContainsString('alice-device', $this->allLoggedText());
    }

    public function test_sweep_without_failures_logs_no_summary(): void
    {
        $this->seedDueNotificationWithSubscription('alice');

        $this->assertSame(0, Artisan::call('wgw:notify:vapid-sweep'));
        $output = Artisan::output();
        $this->assertStringContainsString('sent 1 payload(s)', $output);
        $this->assertStringNotContainsString('failed', $output);

        $this->assertSame([], $this->logsNamed('vapid_send_rejected'));
        $this->assertSame([], $this->logsNamed('vapid_sweep_failures'));
    }

    private function seedDueNotificationWithSubscription(string $principal): void
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
        $notification = Notification::query()->where('principal', $principal)->first();
        $this->assertNotNull($notification);
        NotificationDelivery::query()->where('notification_id', $notification->id)->update([
            'due_at' => Carbon::now()->subMinute(),
        ]);

        $endpoint = 'https://fcm.googleapis.com/fcm/send/'.$principal.'-device';
        $keys = $this->subscriptionKeys();
        PushSubscription::query()->create([
            'id' => (string) Str::ulid(),
            'principal' => $principal,
            'endpoint' => $endpoint,
            'endpoint_hash' => hash('sha256', $endpoint),
            'p256dh' => $keys['p256dh'],
            'auth' => $keys['auth'],
            'user_agent' => null,
            'created_at' => Carbon::now(),
            'updated_at' => Carbon::now(),
        ]);
    }
}
