<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Principal;
use DateTimeImmutable;
use DateTimeInterface;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\ITip\Message;

/**
 * Structured facts + copy for calendar.rsvp: invitee replied to the organizer.
 */
final class CalendarRsvpNotify
{
    public const ACTION = 'rsvp';

    public const NAVIGATE = '/calendar';

    /**
     * @return array{
     *     actor: string,
     *     summary: string,
     *     uid: string,
     *     participationStatus: string,
     *     start: string|null,
     *     end: string|null,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }|null
     */
    public static function fromITipMessage(string $inviteeUsername, Message $message): ?array
    {
        $uid = trim((string) ($message->uid ?? ''));
        if ($uid === '') {
            return null;
        }
        $vevent = self::vevent($message);
        $summary = $vevent !== null ? trim((string) ($vevent->SUMMARY ?? '')) : '';
        $status = self::participationStatus($message, $vevent);
        if ($status === '') {
            return null;
        }

        return self::eventData(
            self::actorLabel($inviteeUsername),
            $summary,
            $uid,
            $status,
            self::dateProperty($vevent, 'DTSTART'),
            self::dateProperty($vevent, 'DTEND'),
            $inviteeUsername,
        );
    }

    /**
     * @return array{
     *     actor: string,
     *     summary: string,
     *     uid: string,
     *     participationStatus: string,
     *     start: string|null,
     *     end: string|null,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }
     */
    public static function eventData(
        string $inviteeLabel,
        string $summary,
        string $uid,
        string $participationStatus,
        ?DateTimeImmutable $start,
        ?DateTimeImmutable $end,
        string $inviteeUsername,
    ): array {
        return [
            'actor' => trim($inviteeLabel),
            'summary' => trim($summary),
            'uid' => trim($uid),
            'participationStatus' => strtolower(trim($participationStatus)),
            'start' => NotificationCopyFormatter::dateAtom($start),
            'end' => NotificationCopyFormatter::dateAtom($end),
            'navigate' => self::NAVIGATE,
            'tag' => self::tag($uid, $inviteeUsername),
            'dedupe_key' => self::dedupeKey($uid, $inviteeUsername),
            'supersede' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $actor = trim((string) ($data['actor'] ?? ''));
        if ($actor === '') {
            $actor = 'Someone';
        }
        $summary = trim((string) ($data['summary'] ?? ''));
        if ($summary === '') {
            $summary = 'an event';
        }
        $status = self::statusLabel((string) ($data['participationStatus'] ?? ''));
        $start = NotificationCopyFormatter::parseDate($data['start'] ?? null);
        $end = NotificationCopyFormatter::parseDate($data['end'] ?? null);
        $when = $start instanceof DateTimeImmutable
            ? AlertDueNotify::whenLabel('calendar', $start, $end)
            : null;

        return [
            'title' => $actor.' '.$status.' '.$summary,
            'body' => $when,
        ];
    }

    public static function dedupeKey(string $uid, string $attendeeUsername): string
    {
        return 'calendar.rsvp:'.trim($uid).':'.strtolower(trim($attendeeUsername));
    }

    public static function tag(string $uid, string $attendeeUsername): string
    {
        return self::dedupeKey($uid, $attendeeUsername);
    }

    public static function actorLabel(string $username): string
    {
        $trimmed = trim($username);
        if ($trimmed === '') {
            return 'Someone';
        }
        $principal = Principal::forUsername($trimmed);
        $name = trim((string) ($principal?->displayname ?? ''));

        return $name !== '' ? $name : $trimmed;
    }

    public static function statusLabel(string $status): string
    {
        return match (strtolower(trim($status))) {
            'accepted', 'accept' => 'accepted',
            'declined', 'decline' => 'declined',
            'tentative' => 'tentatively accepted',
            default => 'responded to',
        };
    }

    private static function participationStatus(Message $message, ?VEvent $vevent): string
    {
        if ($vevent === null || ! isset($vevent->ATTENDEE)) {
            return '';
        }
        $sender = strtolower(trim((string) ($message->sender ?? '')));
        foreach ($vevent->ATTENDEE as $attendee) {
            $href = strtolower(trim((string) $attendee));
            if ($sender !== '' && $href !== $sender && ! str_ends_with($href, $sender)) {
                // Prefer the attendee matching the REPLY sender when present.
                continue;
            }
            $partstat = strtoupper(trim((string) ($attendee['PARTSTAT'] ?? '')));
            if ($partstat !== '') {
                return $partstat;
            }
        }
        foreach ($vevent->ATTENDEE as $attendee) {
            $partstat = strtoupper(trim((string) ($attendee['PARTSTAT'] ?? '')));
            if ($partstat !== '' && $partstat !== 'NEEDS-ACTION') {
                return $partstat;
            }
        }

        return '';
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
