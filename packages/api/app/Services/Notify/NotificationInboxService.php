<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Exceptions\ApiHttpException;
use App\Models\Notification;
use App\Models\NotificationDelivery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

final class NotificationInboxService
{
    /**
     * @return array{list: list<array<string, mixed>>, unreadCount: int}
     */
    public function list(string $username, bool $unreadOnly = false): array
    {
        $query = Notification::query()
            ->where('principal', strtolower($username))
            ->orderByDesc('created_at');
        if ($unreadOnly) {
            $query->whereNull('read_at');
        }
        $rows = $query->limit(100)->get();
        $unreadCount = Notification::query()
            ->where('principal', strtolower($username))
            ->whereNull('read_at')
            ->count();

        return [
            'list' => $rows->map(fn (Notification $row): array => $this->serialize($row))->all(),
            'unreadCount' => $unreadCount,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function ack(string $username, string $id): array
    {
        $row = Notification::query()
            ->where('principal', strtolower($username))
            ->where('id', $id)
            ->first();
        if ($row === null) {
            throw new ApiHttpException(404, 'Notification not found.', 'not_found');
        }
        $now = Carbon::now();
        if ($row->read_at === null) {
            $row->read_at = $now;
            $row->save();
        }
        NotificationDelivery::query()
            ->where('notification_id', $row->id)
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->whereNull('acked_at')
            ->update(['acked_at' => $now]);

        return $this->serialize($row->fresh() ?? $row);
    }

    /**
     * Record that the client showed a local Notification API toast (tab unfocused).
     */
    public function ackLocalDelivery(string $username, string $id): void
    {
        $row = Notification::query()
            ->where('principal', strtolower($username))
            ->where('id', $id)
            ->first();
        if ($row === null) {
            throw new ApiHttpException(404, 'Notification not found.', 'not_found');
        }
        NotificationDelivery::query()
            ->where('notification_id', $row->id)
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->whereNull('acked_at')
            ->update(['acked_at' => Carbon::now()]);
    }

    /**
     * @return array<string, mixed>
     */
    public function serialize(Notification $row): array
    {
        return [
            'id' => (string) $row->id,
            'eventId' => (string) $row->event_id,
            'domain' => (string) $row->domain,
            'action' => (string) $row->action,
            'title' => (string) $row->title,
            'body' => $row->body !== null ? (string) $row->body : null,
            'navigate' => (string) $row->navigate,
            'tag' => $row->tag !== null ? (string) $row->tag : null,
            'readAt' => $row->read_at?->toIso8601String(),
            'createdAt' => $row->created_at?->toIso8601String(),
        ];
    }

    public function recordLocalDelivery(Notification $row, int $delaySeconds = 45): void
    {
        $exists = NotificationDelivery::query()
            ->where('notification_id', $row->id)
            ->where('channel', NotificationDelivery::CHANNEL_LOCAL)
            ->exists();
        if ($exists) {
            return;
        }
        $now = Carbon::now();
        NotificationDelivery::query()->create([
            'id' => (string) Str::ulid(),
            'notification_id' => $row->id,
            'principal' => (string) $row->principal,
            'channel' => NotificationDelivery::CHANNEL_LOCAL,
            'due_at' => $now->copy()->addSeconds($delaySeconds),
            'created_at' => $now,
        ]);
    }
}
