<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Notification;
use App\Services\Chat\ChatMessagePostedNotify;
use DateTimeImmutable;
use DateTimeInterface;

/**
 * Format inbox/VAPID title+body from structured notification facts.
 * When {@see Notification::$data} is empty, legacy title/body columns win.
 */
final class NotificationCopyFormatter
{
    /**
     * @return array{title: string, body: string|null}
     */
    public static function forNotification(Notification $notification): array
    {
        $data = $notification->data;
        if (! is_array($data) || $data === []) {
            return [
                'title' => (string) $notification->title,
                'body' => $notification->body !== null ? (string) $notification->body : null,
            ];
        }

        return self::format(
            (string) $notification->domain,
            (string) $notification->action,
            $data,
            (string) $notification->title,
            $notification->body !== null ? (string) $notification->body : null,
        );
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function format(
        string $domain,
        string $action,
        array $data,
        string $legacyTitle = 'Notification',
        ?string $legacyBody = null,
    ): array {
        $key = $domain.'.'.$action;

        return match ($key) {
            'docs.shared' => DocsSharedNotify::formatCopy($data),
            'calendar.alert_due', 'tasks.alert_due' => AlertDueNotify::formatCopy($domain, $data),
            'calendar.invite' => CalendarInviteNotify::formatCopy($data),
            'chat.message_posted' => ChatMessagePostedNotify::formatCopy($data),
            default => [
                'title' => $legacyTitle !== '' ? $legacyTitle : 'Notification',
                'body' => $legacyBody,
            ],
        };
    }

    /**
     * Strip pipeline-control keys; keep display facts for the `data` column.
     *
     * @param  array<string, mixed>  $eventData
     * @return array<string, mixed>|null
     */
    public static function factsFromEventData(array $eventData): ?array
    {
        $facts = $eventData;
        unset(
            $facts['recipients'],
            $facts['clear'],
            $facts['supersede'],
            $facts['dedupe_key'],
            $facts['title'],
            $facts['body'],
            $facts['navigate'],
            $facts['tag'],
            $facts['trigger'],
        );

        return $facts === [] ? null : $facts;
    }

    public static function parseDate(mixed $value): ?DateTimeImmutable
    {
        if ($value instanceof DateTimeImmutable) {
            return $value;
        }
        if ($value instanceof DateTimeInterface) {
            return DateTimeImmutable::createFromInterface($value);
        }
        if (! is_string($value) || trim($value) === '') {
            return null;
        }
        try {
            return new DateTimeImmutable(trim($value));
        } catch (\Throwable) {
            return null;
        }
    }

    public static function dateAtom(?DateTimeImmutable $dt): ?string
    {
        return $dt?->format(DateTimeInterface::ATOM);
    }
}
