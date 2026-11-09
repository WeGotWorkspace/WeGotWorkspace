<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Events\EventDispatch;
use App\Models\Notification;
use App\Models\NotificationDelivery;
use App\Models\PushSubscription;
use App\Services\Notify\MeetStartedNotify;
use App\Services\Notify\UrgentPushService;
use App\Services\Notify\VapidPushService;
use App\Services\Notify\WebPushSender;
use Illuminate\Foundation\Http\Events\RequestHandled;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\RecordingWebPushSender;
use Tests\Support\WgwDatabaseTestCase;

use function Illuminate\Support\defer;

/**
 * Urgent Web Push (#1670): `meet.started` goes out right after the write's
 * response, bounded in count and time; the sweep finishes what is left and
 * never sends a subscription the same notification twice.
 */
final class UrgentPushTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    private const ROOM = 'standup-room';

    private RecordingWebPushSender $sender;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->sender = new RecordingWebPushSender;
        $this->app->instance(WebPushSender::class, $this->sender);
        $this->app->forgetInstance(VapidPushService::class);
        $this->app->forgetInstance(UrgentPushService::class);
        Carbon::setTestNow(Carbon::parse('2026-11-03T12:00:00Z'));
        // Users here share with each other; Epic #1915 only lets colleagues share.
        $this->seedSharedTeamForEveryone();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_urgent_action_calls_the_sender_after_the_response(): void
    {
        $bobPhone = $this->subscription('bob', 'phone');
        $bobLaptop = $this->subscription('bob', 'laptop');
        $channelId = $this->meetingChannelSharedWith(['bob']);
        Event::listen(RequestHandled::class, function (): void {
            $this->sender->responseBuilt = true;
        });

        $this->asUser('alice')->postJson('/api/v1/rooms/'.$channelId.'/participants', [
            'peerId' => 'alice-peer',
            'name' => 'Alice',
        ])->assertOk();

        $this->assertCount(1, $this->sender->batches);
        $this->assertTrue($this->sender->batches[0]['afterResponse'], 'The push must go out after the response, not inside the request.');
        $this->assertEqualsCanonicalizing([$bobPhone, $bobLaptop], $this->sender->batches[0]['endpoints']);
        $this->assertSame(1.5, $this->sender->batches[0]['timeout']);
        $this->assertNotNull($this->localDelivery('bob')->sent_at);
        $this->assertSame(2, $this->vapidRows('bob'));

        $payload = json_decode($this->sender->sent[0]['payload'], true, 512, JSON_THROW_ON_ERROR);
        $row = Notification::query()->where('principal', 'bob')->where('action', 'started')->firstOrFail();
        $this->assertSame($row->id, $payload['id']);
        $this->assertSame('meet', $payload['domain']);
        $this->assertSame('started', $payload['action']);
        $this->assertSame('Alice started a meeting', $payload['title']);
    }

    public function test_urgent_send_waits_for_the_deferred_callbacks(): void
    {
        $this->subscription('bob', 'phone');

        $this->fireMeetStarted(['bob']);

        $this->assertSame([], $this->sender->batches, 'Nothing may be sent while the request is still running.');
        $delivery = $this->localDelivery('bob');
        $this->assertTrue($delivery->due_at->equalTo(Carbon::now()->addSeconds(UrgentPushService::SWEEP_HOLD_SECONDS)));

        defer()->invoke();

        $this->assertCount(1, $this->sender->batches);
        $this->assertNotNull($this->localDelivery('bob')->sent_at);
    }

    public function test_normal_action_keeps_the_grace_and_sends_nothing_after_the_response(): void
    {
        $this->subscription('bob', 'phone');

        app(EventDispatch::class)->fireMutation('alice', 'docs', 'shared', 'docs/plan', [
            'recipients' => ['bob'],
            'title' => 'Plan shared',
            'navigate' => '/docs/plan',
        ]);
        defer()->invoke();

        $this->assertSame([], $this->sender->batches);
        $this->assertSame([], $this->sender->sent);
        $delivery = $this->localDelivery('bob');
        $this->assertTrue($delivery->due_at->equalTo(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS)));

        Carbon::setTestNow(Carbon::now()->addSeconds(UrgentPushService::SWEEP_HOLD_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $this->assertSame([], $this->sender->sent, 'A normal action is not due before its 20 s grace.');
    }

    public function test_cap_leaves_the_rest_due_for_the_sweep(): void
    {
        config(['wgw.push.urgent.max_subscriptions' => 3]);
        $bobOld = $this->subscription('bob', 'old', minutesAgo: 30);
        $bobMid = $this->subscription('bob', 'mid', minutesAgo: 20);
        $bobNew = $this->subscription('bob', 'new', minutesAgo: 10);
        $carolOld = $this->subscription('carol', 'old', minutesAgo: 30);
        $carolNew = $this->subscription('carol', 'new', minutesAgo: 10);

        $this->fireMeetStarted(['bob', 'carol']);
        defer()->invoke();

        // One recipient at a time, newest subscription first.
        $this->assertSame([$bobNew, $carolNew, $bobMid], $this->sender->batches[0]['endpoints']);
        $this->assertNull($this->localDelivery('bob')->sent_at);
        $this->assertNull($this->localDelivery('carol')->sent_at);

        $this->sender->sent = [];
        app(VapidPushService::class)->sweepDue();
        $this->assertSame([], $this->sender->sent, 'The sweep waits for the hold so it cannot race the send.');

        Carbon::setTestNow(Carbon::now()->addSeconds(UrgentPushService::SWEEP_HOLD_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $this->assertEqualsCanonicalizing([$bobOld, $carolOld], $this->sender->sentEndpoints());
        $this->assertNotNull($this->localDelivery('bob')->sent_at);
        $this->assertNotNull($this->localDelivery('carol')->sent_at);
    }

    public function test_timeout_leaves_only_unfinished_subscriptions_due(): void
    {
        $fast = $this->subscription('bob', 'fast');
        $slow = $this->subscription('bob', 'slow');
        $this->sender->statusByEndpoint[$slow] = 0;

        $this->fireMeetStarted(['bob']);
        defer()->invoke();

        $this->assertEqualsCanonicalizing([$fast, $slow], $this->sender->batches[0]['endpoints']);
        $this->assertNull($this->localDelivery('bob')->sent_at);
        $this->assertSame(1, $this->vapidRows('bob'));

        $this->sender->sent = [];
        $this->sender->statusByEndpoint = [];
        Carbon::setTestNow(Carbon::now()->addSeconds(UrgentPushService::SWEEP_HOLD_SECONDS));
        app(VapidPushService::class)->sweepDue();

        $this->assertSame([$slow], $this->sender->sentEndpoints());
        $this->assertNotNull($this->localDelivery('bob')->sent_at);
    }

    public function test_sweep_sends_only_to_subscriptions_the_urgent_send_left_open(): void
    {
        $ok = $this->subscription('bob', 'ok');
        $flaky = $this->subscription('bob', 'flaky');
        $this->sender->statusByEndpoint[$flaky] = 503;

        $this->fireMeetStarted(['bob']);
        defer()->invoke();

        $sweep = app(VapidPushService::class);
        // Still failing on the first sweep: retried later, the other device never again.
        $this->sender->sent = [];
        Carbon::setTestNow(Carbon::now()->addSeconds(UrgentPushService::SWEEP_HOLD_SECONDS));
        $sweep->sweepDue();
        $this->assertSame([$flaky], $this->sender->sentEndpoints());
        $this->assertNull($this->localDelivery('bob')->sent_at);

        $this->sender->sent = [];
        $this->sender->statusByEndpoint = [];
        Carbon::setTestNow(Carbon::now()->addMinutes(2));
        $sweep->sweepDue();
        $this->assertSame([$flaky], $this->sender->sentEndpoints());
        $this->assertNotNull($this->localDelivery('bob')->sent_at);

        $this->sender->sent = [];
        Carbon::setTestNow(Carbon::now()->addMinutes(5));
        $sweep->sweepDue();
        $this->assertSame([], $this->sender->sent);
        $this->assertNotContains($ok, $this->sender->sentEndpoints());
    }

    public function test_sweep_retries_only_the_subscription_that_failed(): void
    {
        $ok = $this->subscription('bob', 'ok');
        $flaky = $this->subscription('bob', 'flaky');
        $this->sender->statusByEndpoint[$flaky] = 500;
        app(EventDispatch::class)->fireMutation('alice', 'docs', 'shared', 'docs/plan', [
            'recipients' => ['bob'],
            'navigate' => '/docs/plan',
        ]);

        $sweep = app(VapidPushService::class);
        Carbon::setTestNow(Carbon::now()->addSeconds(NotificationDelivery::LOCAL_ACK_GRACE_SECONDS));
        $sweep->sweepDue();
        $this->assertEqualsCanonicalizing([$ok, $flaky], $this->sender->sentEndpoints());
        $this->assertNull($this->localDelivery('bob')->sent_at);

        $this->sender->sent = [];
        $this->sender->statusByEndpoint = [];
        Carbon::setTestNow(Carbon::now()->addMinutes(2));
        $sweep->sweepDue();
        $this->assertSame([$flaky], $this->sender->sentEndpoints());
        $this->assertNotNull($this->localDelivery('bob')->sent_at);
    }

    public function test_urgent_send_respects_push_scopes(): void
    {
        $meetApp = $this->subscription('bob', 'meet-app', scopes: '/meet');
        $this->subscription('bob', 'docs-app', scopes: '/docs');

        $this->fireMeetStarted(['bob']);
        defer()->invoke();

        $this->assertSame([$meetApp], $this->sender->batches[0]['endpoints']);
        $payload = json_decode($this->sender->sent[0]['payload'], true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame('/meet', $payload['scope']);
        $this->assertNotNull($this->localDelivery('bob')->sent_at, 'A subscription outside the scope is not left open.');
    }

    public function test_urgent_send_prunes_permanently_rejected_subscriptions(): void
    {
        $gone = $this->subscription('bob', 'gone');
        $this->sender->statusByEndpoint[$gone] = 410;

        $this->fireMeetStarted(['bob']);
        defer()->invoke();

        $this->assertSame(0, PushSubscription::query()->where('endpoint', $gone)->count());
        $this->assertNotNull($this->localDelivery('bob')->sent_at);
    }

    public function test_an_ack_before_the_sweep_stops_the_leftovers(): void
    {
        config(['wgw.push.urgent.max_subscriptions' => 1]);
        $this->subscription('bob', 'first', minutesAgo: 1);
        $this->subscription('bob', 'second', minutesAgo: 5);

        $this->fireMeetStarted(['bob']);
        defer()->invoke();
        $this->assertCount(1, $this->sender->sent);

        $row = Notification::query()->where('principal', 'bob')->firstOrFail();
        $this->asUser('bob')->postJson('/api/v1/notifications/'.$row->id.'/local-ack')->assertOk();

        $this->sender->sent = [];
        Carbon::setTestNow(Carbon::now()->addSeconds(UrgentPushService::SWEEP_HOLD_SECONDS));
        app(VapidPushService::class)->sweepDue();
        $this->assertSame([], $this->sender->sent);
    }

    /**
     * @param  list<string>  $recipients
     */
    private function fireMeetStarted(array $recipients): void
    {
        app(EventDispatch::class)->fireMutation(
            'alice',
            'meet',
            MeetStartedNotify::ACTION,
            'meet/'.self::ROOM,
            MeetStartedNotify::eventData('Alice', self::ROOM, $recipients),
        );
    }

    /**
     * @param  list<string>  $members
     */
    private function meetingChannelSharedWith(array $members): string
    {
        $channelId = (string) $this->asUser('alice')->postJson('/api/v1/chat/channels', [
            'name' => 'Standup',
            'kind' => 'meeting',
        ])->assertCreated()->json('id');
        $share = [];
        foreach ($members as $member) {
            $share[$member] = ['mayWriteAll' => true];
        }
        $this->asUser('alice')->patchJson('/api/v1/chat/channels/'.$channelId, ['shareWith' => $share])->assertOk();
        $this->asUser('alice')->postJson('/api/v1/meetings/rooms', [
            'room' => $channelId,
            'ownerPrincipal' => 'u:alice',
        ])->assertCreated();
        Notification::query()->delete();
        NotificationDelivery::query()->delete();

        return $channelId;
    }

    private function subscription(string $principal, string $device, int $minutesAgo = 0, ?string $scopes = null): string
    {
        $endpoint = 'https://fcm.googleapis.com/fcm/send/'.$principal.'-'.$device;
        $at = Carbon::now()->subMinutes($minutesAgo);
        PushSubscription::query()->create([
            'id' => (string) Str::ulid(),
            'principal' => $principal,
            'endpoint' => $endpoint,
            'endpoint_hash' => hash('sha256', $endpoint),
            'p256dh' => 'pub',
            'auth' => 'secret',
            'scopes' => $scopes,
            'created_at' => $at,
            'updated_at' => $at,
        ]);

        return $endpoint;
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    private function localDelivery(string $principal): NotificationDelivery
    {
        return NotificationDelivery::query()
            ->where('principal', $principal)
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->firstOrFail();
    }

    private function vapidRows(string $principal): int
    {
        return NotificationDelivery::query()
            ->where('principal', $principal)
            ->where('channel', NotificationDelivery::CHANNEL_VAPID)
            ->count();
    }
}
