<?php

declare(strict_types=1);

namespace App\Events;

use App\Models\Notification;
use App\Models\NotificationDelivery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Curated notify consumer. Allow-list only — most WorkspaceEvents are ignored.
 */
final class NotifyListener implements WorkspaceEventListener
{
    /** @var list<array{0: string, 1: string}> */
    private const ALLOW_LIST = [
        ['docs', 'shared'],
        ['calendar', 'alert_due'],
        ['tasks', 'alert_due'],
        ['chat', 'message_posted'],
    ];

    public function handle(WorkspaceEvent $event): void
    {
        if (! $this->allowed($event)) {
            return;
        }

        $recipients = $this->recipients($event);
        foreach ($recipients as $principal) {
            if ($principal === '' || strcasecmp($principal, $event->actor) === 0) {
                continue;
            }
            $this->upsertInbox($event, $principal);
        }
    }

    private function allowed(WorkspaceEvent $event): bool
    {
        foreach (self::ALLOW_LIST as [$domain, $action]) {
            if ($event->domain === $domain && $event->action === $action) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return list<string>
     */
    private function recipients(WorkspaceEvent $event): array
    {
        $raw = $event->data['recipients'] ?? [];
        if (! is_array($raw) || $raw === []) {
            return [];
        }
        $out = [];
        foreach ($raw as $username) {
            if (! is_string($username)) {
                continue;
            }
            $trimmed = strtolower(trim($username));
            if ($trimmed !== '') {
                $out[$trimmed] = $trimmed;
            }
        }

        return array_values($out);
    }

    private function upsertInbox(WorkspaceEvent $event, string $principal): void
    {
        $dedupe = $this->dedupeKey($event, $principal);
        $existing = Notification::query()
            ->where('principal', $principal)
            ->where('dedupe_key', $dedupe)
            ->first();
        if ($existing !== null) {
            return;
        }

        $id = (string) Str::ulid();
        $now = Carbon::now();
        $row = Notification::query()->create([
            'id' => $id,
            'principal' => $principal,
            'event_id' => $event->eventId,
            'domain' => $event->domain,
            'action' => $event->action,
            'title' => $this->stringData($event, 'title', $this->defaultTitle($event)),
            'body' => $this->stringData($event, 'body', null),
            'navigate' => $this->stringData($event, 'navigate', '/'),
            'tag' => $this->stringData($event, 'tag', $event->domain.'.'.$event->action),
            'dedupe_key' => $dedupe,
            'read_at' => null,
            'created_at' => $now,
        ]);

        NotificationDelivery::query()->create([
            'id' => (string) Str::ulid(),
            'notification_id' => $row->id,
            'principal' => $principal,
            'channel' => NotificationDelivery::CHANNEL_LOCAL,
            'due_at' => $now->copy()->addSeconds(45),
            'acked_at' => null,
            'sent_at' => null,
            'created_at' => $now,
        ]);
    }

    private function dedupeKey(WorkspaceEvent $event, string $principal): string
    {
        $fromData = $event->data['dedupe_key'] ?? null;
        if (is_string($fromData) && $fromData !== '') {
            return $principal.':'.$fromData;
        }

        return $principal.':'.$event->eventId;
    }

    private function stringData(WorkspaceEvent $event, string $key, ?string $fallback): ?string
    {
        $value = $event->data[$key] ?? null;
        if (is_string($value) && $value !== '') {
            return $value;
        }

        return $fallback;
    }

    private function defaultTitle(WorkspaceEvent $event): string
    {
        return match ($event->domain.'.'.$event->action) {
            'docs.shared' => 'A document was shared with you',
            'calendar.alert_due' => 'Calendar reminder',
            'tasks.alert_due' => 'Task reminder',
            'chat.message_posted' => 'New chat message',
            default => 'Notification',
        };
    }
}
