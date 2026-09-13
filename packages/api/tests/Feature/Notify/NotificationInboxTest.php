<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Models\Notification;
use App\Models\NotificationDelivery;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\WgwDatabaseTestCase;

final class NotificationInboxTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_inbox_list_and_ack(): void
    {
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: 'bob',
            domain: 'docs',
            action: 'shared',
            target: '/users/bob/doc.md',
            data: [
                'recipients' => ['alice'],
                'title' => 'doc.md was shared with you',
                'body' => 'bob shared a document with you.',
                'navigate' => '/docs',
                'tag' => 'docs.shared:test',
            ],
        ));

        $token = $this->issueBearerTokenFor('alice');
        $list = $this->withBearer($token)->getJson('/api/v1/notifications')->assertOk()->json();
        $this->assertSame(1, $list['unreadCount']);
        $this->assertCount(1, $list['list']);
        $this->assertSame('doc.md was shared with you', $list['list'][0]['title']);
        $this->assertSame('/docs', $list['list'][0]['navigate']);
        $id = $list['list'][0]['id'];

        $bobList = $this->withBearer($this->issueBearerTokenFor('bob'))
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->json();
        $this->assertSame(0, $bobList['unreadCount']);

        $this->withBearer($token)->postJson('/api/v1/notifications/'.$id.'/ack')
            ->assertOk()
            ->assertJsonPath('readAt', fn ($v) => is_string($v) && $v !== '');

        $after = $this->withBearer($token)->getJson('/api/v1/notifications')->assertOk()->json();
        $this->assertSame(0, $after['unreadCount']);
    }

    public function test_uncurated_events_do_not_create_inbox_rows(): void
    {
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: 'bob',
            domain: 'calendars',
            action: 'created',
            target: 'calendars/bob/default/x.ics',
            data: ['recipients' => ['alice']],
        ));

        $this->assertSame(0, Notification::query()->count());
    }

    public function test_schedule_registers_minute_commands_and_empty_tables_succeed(): void
    {
        $this->assertSame(0, Artisan::call('schedule:list'));
        $listed = Artisan::output();
        $this->assertStringContainsString('wgw:notify:due-alarms', $listed);
        $this->assertStringContainsString('wgw:notify:vapid-sweep', $listed);

        $this->assertSame(0, Artisan::call('wgw:notify:due-alarms'));
        $this->assertSame(0, Artisan::call('wgw:notify:vapid-sweep'));
        $this->assertSame(0, NotificationDelivery::query()->count());
    }
}
