<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Events\EventDispatch;
use App\Services\Notify\CalendarInviteNotify;
use App\Services\Notify\CalendarRsvpNotify;
use Sabre\VObject\ITip\Message;

/**
 * Suite notifications for an iTIP message that was delivered to a local
 * principal: an invite or reschedule (REQUEST) rings the attendee, an RSVP
 * (REPLY) rings the organizer, and a cancel (CANCEL) clears the attendee's
 * invite row. Both delivery paths call it after they land the message: the
 * web app's {@see CalendarSchedulingService} and, for CalDAV clients, the
 * DAV CalendarScheduleNotifyPlugin after Sabre's own local delivery (#2057).
 */
final class CalendarSchedulingNotifier
{
    public function __construct(
        private readonly EventDispatch $eventDispatch,
    ) {}

    /** Notify for $message, which $actorUsername sent and which reached $principalUri. */
    public function delivered(string $actorUsername, string $principalUri, Message $message): void
    {
        match (strtoupper((string) $message->method)) {
            'REQUEST' => $this->inviteRequest($actorUsername, $principalUri, $message),
            'REPLY' => $this->rsvpReply($actorUsername, $principalUri, $message),
            'CANCEL' => $this->inviteClear($actorUsername, $principalUri, (string) $message->uid),
            default => null,
        };
    }

    public function inviteRequest(string $actorUsername, string $principalUri, Message $message): void
    {
        $invitee = self::username($principalUri);
        if ($invitee === '') {
            return;
        }
        $copy = CalendarInviteNotify::fromITipMessage($actorUsername, $message);
        if ($copy === null) {
            return;
        }
        $uid = trim((string) ($message->uid));
        $this->eventDispatch->fireMutation(
            $actorUsername,
            'calendar',
            CalendarInviteNotify::ACTION,
            $uid !== '' ? 'calendars/invite/'.$uid : 'calendars/invite',
            [
                'recipients' => [$invitee],
                ...$copy,
            ],
        );
    }

    public function inviteClear(string $actorUsername, string $principalUri, string $uid): void
    {
        $invitee = self::username($principalUri);
        $trimmedUid = trim($uid);
        if ($invitee === '' || $trimmedUid === '') {
            return;
        }
        $this->eventDispatch->fireMutation(
            $actorUsername,
            'calendar',
            CalendarInviteNotify::ACTION,
            'calendars/invite/'.$trimmedUid,
            [
                'recipients' => [$invitee],
                ...CalendarInviteNotify::clearData($trimmedUid),
            ],
        );
    }

    public function rsvpReply(string $actorUsername, string $principalUri, Message $message): void
    {
        $organizer = self::username($principalUri);
        if ($organizer === '' || strcasecmp($organizer, $actorUsername) === 0) {
            // Organizer is the writer (e.g. guest iMIP token path) — no self-notify loop.
            return;
        }
        $copy = CalendarRsvpNotify::fromITipMessage($actorUsername, $message);
        if ($copy === null) {
            return;
        }
        $uid = trim((string) ($message->uid));
        $this->eventDispatch->fireMutation(
            $actorUsername,
            'calendar',
            CalendarRsvpNotify::ACTION,
            $uid !== '' ? 'calendars/rsvp/'.$uid : 'calendars/rsvp',
            [
                'recipients' => [$organizer],
                ...$copy,
            ],
        );
    }

    private static function username(string $principalUri): string
    {
        return str_starts_with($principalUri, 'principals/')
            ? substr($principalUri, strlen('principals/'))
            : $principalUri;
    }
}
