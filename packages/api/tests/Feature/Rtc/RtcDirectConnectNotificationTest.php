<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use App\Models\Notification;
use App\Models\RtcRelayEvent;
use App\Services\Rtc\RtcDirectConnectNotifier;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwRoleFixtures;

final class RtcDirectConnectNotificationTest extends WgwDatabaseTestCase
{
    use WgwRoleFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureRoleMatrix();
    }

    public function test_unavailable_outcomes_bundle_into_one_admin_notice_per_day(): void
    {
        $now = time();
        $this->insertUnavailable($now - 30, 'bob', 'meet');
        $this->insertUnavailable($now - 20, 'carol', 'collab');
        app(RtcDirectConnectNotifier::class)->notifyFromToday($now);

        $rows = Notification::query()->where('principal', 'alice')->get();
        $this->assertCount(1, $rows);
        $notice = $rows->first();
        $this->assertNotNull($notice);
        $this->assertSame('rtc', $notice->domain);
        $this->assertSame('direct_connect', $notice->action);
        $this->assertSame(
            "2 people couldn't connect directly to a call or document today.",
            $notice->title,
        );
        $this->assertSame('bob (Meet), carol (Docs)', $notice->body);
        $this->assertSame('/admin/realtime-health', $notice->navigate);
        $encoded = (string) json_encode($notice->data);
        $this->assertStringNotContainsString('symmetric', $encoded);
        $this->assertStringNotContainsString('udp-blocked', $encoded);
        $this->assertStringNotContainsString('room', $encoded);

        $this->insertUnavailable($now - 10, 'bob', 'collab');
        app(RtcDirectConnectNotifier::class)->notifyFromToday($now);

        $again = Notification::query()->where('principal', 'alice')->get();
        $this->assertCount(1, $again);
        $this->assertSame($notice->id, $again->first()?->id);
        $this->assertSame(
            "2 people couldn't connect directly to a call or document today.",
            $again->first()?->title,
        );
        $this->assertSame('bob (Docs and Meet), carol (Docs)', $again->first()?->body);
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->count());
    }

    private function insertUnavailable(int $createdAt, string $actor, string $channel): void
    {
        RtcRelayEvent::query()->create([
            'created_at' => $createdAt,
            'channel' => $channel,
            'actor' => $actor,
            'reason' => 'failed',
            'outcome' => 'unavailable',
        ]);
    }
}
