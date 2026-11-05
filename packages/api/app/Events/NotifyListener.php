<?php

declare(strict_types=1);

namespace App\Events;

use App\Models\Notification;
use App\Models\NotificationDelivery;
use App\Services\Notify\NotificationCopyFormatter;
use App\Services\Notify\NotifiedRecipients;
use App\Services\Notify\UrgentPushService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Curated notify consumer. Allow-list only — most WorkspaceEvents are ignored.
 *
 * Stores structured facts in {@see Notification::$data}; title/body columns are
 * denormalized via {@see NotificationCopyFormatter} for legacy readers.
 *
 * Urgent actions ({@see UrgentPushService::ACTIONS}) skip the local-ack grace:
 * their Web Push goes out right after the response (#1670).
 *
 * Every principal whose inbox changed is recorded in {@see NotifiedRecipients},
 * so the actor's response can name them for a mesh `check-now` (#1662).
 */
final class NotifyListener implements WorkspaceEventListener
{
    /** @var list<array{0: string, 1: string}> */
    private const ALLOW_LIST = [
        ['docs', 'shared'],
        ['docs', 'thread_activity'],
        ['calendar', 'alert_due'],
        ['calendar', 'invite'],
        ['calendar', 'rsvp'],
        ['calendar', 'shared'],
        ['notes', 'shared'],
        ['tasks', 'alert_due'],
        ['tasks', 'list_shared'],
        ['tasks', 'status_changed'],
        ['chat', 'message_posted'],
        ['chat', 'mentioned'],
        ['meet', 'started'],
    ];

    public function handle(WorkspaceEvent $event): void
    {
        if (! $this->allowed($event)) {
            return;
        }

        $urgent = UrgentPushService::isUrgent($event->domain, $event->action);
        $created = [];
        $recipients = $this->recipients($event);
        $notified = app(NotifiedRecipients::class);
        foreach ($recipients as $principal) {
            if ($principal === '' || strcasecmp($principal, $event->actor) === 0) {
                continue;
            }
            $notified->record($event->actor, $principal);
            if (($event->data['clear'] ?? false) === true) {
                $this->clearInbox($event, $principal);

                continue;
            }
            $id = $this->upsertInbox($event, $principal, $urgent);
            if ($id !== null) {
                $created[] = $id;
            }
        }
        if ($urgent) {
            UrgentPushService::sendAfterResponse($created);
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

    private function clearInbox(WorkspaceEvent $event, string $principal): void
    {
        $dedupe = $this->dedupeKey($event, $principal);
        $existing = Notification::query()
            ->where('principal', $principal)
            ->where('dedupe_key', $dedupe)
            ->first();
        if ($existing === null) {
            return;
        }
        NotificationDelivery::query()->where('notification_id', $existing->id)->delete();
        $existing->delete();
    }

    /**
     * @return string|null id of a newly created row (null when it existed already)
     */
    private function upsertInbox(WorkspaceEvent $event, string $principal, bool $urgent): ?string
    {
        $dedupe = $this->dedupeKey($event, $principal);
        $existing = Notification::query()
            ->where('principal', $principal)
            ->where('dedupe_key', $dedupe)
            ->first();
        $facts = NotificationCopyFormatter::factsFromEventData($event->data);
        $navigate = $this->stringData($event, 'navigate', '/');
        $tag = $this->stringData($event, 'tag', $event->domain.'.'.$event->action);
        $copy = $this->copyForWrite($event, $facts);

        if ($existing !== null) {
            if (($event->data['supersede'] ?? false) !== true) {
                return null;
            }
            $existing->fill([
                'event_id' => $event->eventId,
                'domain' => $event->domain,
                'action' => $event->action,
                'data' => $facts,
                'title' => $copy['title'],
                'body' => $copy['body'],
                'navigate' => $navigate ?? '/',
                'tag' => $tag,
                'read_at' => null,
            ])->save();

            return null;
        }

        $id = (string) Str::ulid();
        $now = Carbon::now();
        $row = Notification::query()->create([
            'id' => $id,
            'principal' => $principal,
            'event_id' => $event->eventId,
            'domain' => $event->domain,
            'action' => $event->action,
            'data' => $facts,
            'title' => $copy['title'],
            'body' => $copy['body'],
            'navigate' => $navigate ?? '/',
            'tag' => $tag,
            'dedupe_key' => $dedupe,
            'read_at' => null,
            'created_at' => $now,
        ]);

        NotificationDelivery::query()->create([
            'id' => (string) Str::ulid(),
            'notification_id' => $row->id,
            'principal' => $principal,
            'channel' => NotificationDelivery::CHANNEL_LOCAL,
            'due_at' => $now->copy()->addSeconds($urgent
                ? UrgentPushService::SWEEP_HOLD_SECONDS
                : NotificationDelivery::LOCAL_ACK_GRACE_SECONDS),
            'acked_at' => null,
            'sent_at' => null,
            'created_at' => $now,
        ]);

        return $row->id;
    }

    /**
     * @param  array<string, mixed>|null  $facts
     * @return array{title: string, body: string|null}
     */
    private function copyForWrite(WorkspaceEvent $event, ?array $facts): array
    {
        $legacyTitle = $this->stringData($event, 'title', $this->defaultTitle($event)) ?? $this->defaultTitle($event);
        $legacyBody = $this->stringData($event, 'body', null);
        if ($facts === null || $facts === []) {
            return [
                'title' => $legacyTitle,
                'body' => $legacyBody,
            ];
        }

        return NotificationCopyFormatter::format(
            $event->domain,
            $event->action,
            $facts,
            $legacyTitle,
            $legacyBody,
        );
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
            'docs.thread_activity' => 'New activity on a document',
            'calendar.alert_due' => 'Calendar reminder',
            'calendar.invite' => 'Calendar invitation',
            'calendar.rsvp' => 'Calendar RSVP update',
            'calendar.shared' => 'A calendar was shared with you',
            'notes.shared' => 'A notebook was shared with you',
            'tasks.alert_due' => 'Task reminder',
            'tasks.list_shared' => 'A task list was shared with you',
            'tasks.status_changed' => 'Task status changed',
            'chat.message_posted' => 'New chat message',
            'chat.mentioned' => 'You were mentioned in chat',
            'meet.started' => 'A meeting started',
            default => 'Notification',
        };
    }
}
