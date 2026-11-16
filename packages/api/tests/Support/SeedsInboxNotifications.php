<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Events\EventDispatch;
use App\Events\WorkspaceEvent;
use App\Models\Notification;
use App\Models\NotificationDelivery;

/**
 * Inbox rows for the notification ack tests: one `docs.shared` row through
 * the real event pipeline, and its local delivery.
 */
trait SeedsInboxNotifications
{
    protected function seedNotification(string $principal, string $file): string
    {
        $before = Notification::query()->where('principal', $principal)->pluck('id')->all();
        app(EventDispatch::class)->fire(WorkspaceEvent::make(
            actor: $principal === 'bob' ? 'alice' : 'bob',
            domain: 'docs',
            action: 'shared',
            target: '/users/someone/'.$file.'.md',
            data: [
                'recipients' => [$principal],
                'title' => $file.'.md was shared with you',
                'navigate' => '/docs',
                'tag' => 'docs.shared:'.$file,
            ],
        ));
        $row = Notification::query()
            ->where('principal', $principal)
            ->whereNotIn('id', $before)
            ->first();
        $this->assertNotNull($row);

        return (string) $row->id;
    }

    protected function localDelivery(string $notificationId): NotificationDelivery
    {
        $delivery = NotificationDelivery::query()
            ->where('notification_id', $notificationId)
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->first();
        $this->assertNotNull($delivery);

        return $delivery;
    }
}
