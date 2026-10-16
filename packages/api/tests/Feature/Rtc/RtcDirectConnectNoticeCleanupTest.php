<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use App\Models\Notification;
use App\Models\NotificationDelivery;
use Illuminate\Support\Carbon;
use Tests\Support\WgwDatabaseTestCase;

final class RtcDirectConnectNoticeCleanupTest extends WgwDatabaseTestCase
{
    public function test_migration_removes_only_direct_connect_notices(): void
    {
        $now = Carbon::now();
        Notification::query()->create([
            'id' => '01DIRECTCONNECTNOTICE01',
            'principal' => 'alice',
            'event_id' => 'evt-direct',
            'domain' => 'rtc',
            'action' => 'direct_connect',
            'data' => ['count' => 1, 'people' => [['name' => 'bob', 'where' => 'Meet']]],
            'title' => "1 people couldn't connect directly to a call or document today.",
            'body' => 'bob (Meet)',
            'navigate' => '/admin/realtime-health',
            'tag' => 'rtc.direct_connect',
            'dedupe_key' => 'alice:rtc.direct_connect:2026-10-16',
            'read_at' => null,
            'created_at' => $now,
        ]);
        NotificationDelivery::query()->create([
            'id' => '01DIRECTCONNECTDELIVERY1',
            'notification_id' => '01DIRECTCONNECTNOTICE01',
            'principal' => 'alice',
            'channel' => NotificationDelivery::CHANNEL_LOCAL,
            'due_at' => $now,
            'created_at' => $now,
        ]);
        Notification::query()->create([
            'id' => '01MEETSTARTEDNOTICE00001',
            'principal' => 'alice',
            'event_id' => 'evt-meet',
            'domain' => 'meet',
            'action' => 'started',
            'data' => ['actor' => 'bob'],
            'title' => 'A meeting started',
            'body' => null,
            'navigate' => '/meet',
            'tag' => 'meet.started',
            'dedupe_key' => 'alice:meet.started:room',
            'read_at' => null,
            'created_at' => $now,
        ]);

        $migration = require base_path('database/migrations/wgw/2026_10_16_000640_wgw_drop_rtc_direct_connect_notifications.php');
        $migration->up();

        $this->assertSame(0, Notification::query()->where('tag', 'rtc.direct_connect')->count());
        $this->assertSame(0, NotificationDelivery::query()->where('notification_id', '01DIRECTCONNECTNOTICE01')->count());
        $this->assertSame(1, Notification::query()->where('action', 'started')->count());
    }
}
