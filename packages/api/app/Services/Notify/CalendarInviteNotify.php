<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Principal;
use DateTimeImmutable;
use DateTimeInterface;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\ITip\Message;

/**
 * Structured facts + copy for calendar.invite: organizer invited invitee to event.
 */
final class CalendarInviteNotify
{
    public const ACTION = 'invite';

    public const NAVIGATE = '/calendar';

    /**
     * @return array{
     *     actor: string,
     *     summary: string,
     *     start: string|null,
     *     end: string|null,
     *     location: string|null,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }
     */
    public static function eventData(
        string $organizerLabel,
        string $summary,
        ?DateTimeImmutable $start,
        ?DateTimeImmutable $end,
        ?string $location,
        string $uid,
    ): array {
        $place = $location !== null ? trim($location) : '';

        return [
            'actor' => trim($organizerLabel),
            'summary' => trim($summary),
            'start' => NotificationCopyFormatter::dateAtom($start),
            'end' => NotificationCopyFormatter::dateAtom($end),
            'location' => $place !== '' ? $place : null,
            'navigate' => self::NAVIGATE,
            'tag' => self::tag($uid),
            'dedupe_key' => self::dedupeKey($uid),
            'supersede' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $label = trim((string) ($data['actor'] ?? ''));
        if ($label === '') {
            $label = 'Someone';
        }
        $titleSummary = trim((string) ($data['summary'] ?? ''));
        if ($titleSummary === '') {
            $titleSummary = 'an event';
        }
        $start = NotificationCopyFormatter::parseDate($data['start'] ?? null);
        $end = NotificationCopyFormatter::parseDate($data['end'] ?? null);
        $location = isset($data['location']) && is_string($data['location'])
            ? $data['location']
            : null;

        return [
            'title' => $label.' invited you to '.$titleSummary,
            'body' => self::body($start, $end, $location),
        ];
    }

    /**
     * @return array{dedupe_key: string, clear: true}
     */
    public static function clearData(string $uid): array
    {
        return [
            'dedupe_key' => self::dedupeKey($uid),
            'clear' => true,
        ];
    }

    public static function dedupeKey(string $uid): string
    {
        return 'calendar.invite:'.trim($uid);
    }

    public static function tag(string $uid): string
    {
        return self::dedupeKey($uid);
    }

    public static function organizerLabel(string $username): string
    {
        $trimmed = trim($username);
        if ($trimmed === '') {
            return 'Someone';
        }
        $principal = Principal::forUsername($trimmed);
        $name = trim((string) ($principal?->displayname ?? ''));

        return $name !== '' ? $name : $trimmed;
    }

    /**
     * @return array{
     *     actor: string,
     *     summary: string,
     *     start: string|null,
     *     end: string|null,
     *     location: string|null,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }|null
     */
    public static function fromITipMessage(string $organizerUsername, Message $message): ?array
    {
        $uid = trim((string) ($message->uid ?? ''));
        if ($uid === '') {
            return null;
        }
        $vevent = self::vevent($message);
        $summary = $vevent !== null ? trim((string) ($vevent->SUMMARY ?? '')) : '';
        $location = null;
        if ($vevent !== null && isset($vevent->LOCATION)) {
            $loc = trim((string) $vevent->LOCATION);
            $location = $loc !== '' ? $loc : null;
        }

        return self::eventData(
            self::organizerLabel($organizerUsername),
            $summary,
            self::dateProperty($vevent, 'DTSTART'),
            self::dateProperty($vevent, 'DTEND'),
            $location,
            $uid,
        );
    }

    public static function body(?DateTimeImmutable $start, ?DateTimeImmutable $end, ?string $location): ?string
    {
        $parts = [];
        if ($start instanceof DateTimeImmutable) {
            $parts[] = AlertDueNotify::whenLabel('calendar', $start, $end);
        }
        $place = $location !== null ? trim($location) : '';
        if ($place !== '') {
            $parts[] = $place;
        }

        return $parts === [] ? null : implode(' · ', $parts);
    }

    private static function vevent(Message $message): ?VEvent
    {
        if (! isset($message->message)) {
            return null;
        }
        $vevent = $message->message->VEVENT ?? null;

        return $vevent instanceof VEvent ? $vevent : null;
    }

    private static function dateProperty(?VEvent $vevent, string $name): ?DateTimeImmutable
    {
        if ($vevent === null || ! isset($vevent->{$name})) {
            return null;
        }
        try {
            $dt = $vevent->{$name}->getDateTime();
        } catch (\Throwable) {
            return null;
        }
        if ($dt instanceof DateTimeImmutable) {
            return $dt;
        }
        if ($dt instanceof DateTimeInterface) {
            return DateTimeImmutable::createFromInterface($dt);
        }

        return null;
    }
}
