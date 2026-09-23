<?php

declare(strict_types=1);

namespace App\Services\Notify;

use DateTimeImmutable;

/**
 * Structured facts + copy for calendar/tasks alert_due: event title + when.
 */
final class AlertDueNotify
{
    /**
     * @return array{
     *     summary: string,
     *     start: string,
     *     end: string|null,
     *     navigate: string,
     *     tag: string
     * }
     */
    public static function eventData(
        string $domain,
        string $summary,
        DateTimeImmutable $start,
        ?DateTimeImmutable $end,
        string $navigate,
        string $tag,
    ): array {
        return [
            'summary' => trim($summary),
            'start' => NotificationCopyFormatter::dateAtom($start) ?? $start->format(DATE_ATOM),
            'end' => NotificationCopyFormatter::dateAtom($end),
            'navigate' => $navigate,
            'tag' => $tag,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(string $domain, array $data): array
    {
        $title = trim((string) ($data['summary'] ?? ''));
        if ($title === '') {
            $title = $domain === 'tasks' ? 'Task reminder' : 'Calendar reminder';
        }
        $start = NotificationCopyFormatter::parseDate($data['start'] ?? null);
        $end = NotificationCopyFormatter::parseDate($data['end'] ?? null);
        $body = $start instanceof DateTimeImmutable
            ? self::whenLabel($domain, $start, $end)
            : null;

        return [
            'title' => $title,
            'body' => $body,
        ];
    }

    public static function whenLabel(string $domain, DateTimeImmutable $start, ?DateTimeImmutable $end): string
    {
        $day = $start->format('D j M');
        $startTime = $start->format('H:i');
        if ($domain === 'tasks') {
            return 'Due '.$day.' · '.$startTime;
        }
        if ($end instanceof DateTimeImmutable && $end != $start) {
            $endTime = $end->format('H:i');
            if ($end->format('Ymd') === $start->format('Ymd')) {
                return $day.' · '.$startTime.' – '.$endTime;
            }

            return $day.' · '.$startTime.' – '.$end->format('D j M · H:i');
        }

        return $day.' · '.$startTime;
    }
}
