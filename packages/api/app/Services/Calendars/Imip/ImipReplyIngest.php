<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Events\EventDispatch;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarObjectSearchIndex;
use App\Services\Calendars\CalendarPrincipalAddresses;
use App\Services\Calendars\CalendarSchedulingDeliveryPolicy;
use App\Services\Calendars\CalendarSchedulingObjects;
use App\Services\Notify\CalendarRsvpNotify;
use App\Services\VObject\VObjectPayloadGuard;
use DateTimeImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\ITip\Broker;
use Sabre\VObject\ITip\Message;

/**
 * Applies one iMIP REPLY (RFC 6047) read from an organizer's mailbox to the
 * organizer's event (#1589). Only a reply from a verified sender, for an
 * event the mailbox owner organizes, changing that sender's own attendee
 * line, is applied; everything else is skipped with a reason code. Applying
 * goes through Sabre's iTIP broker and notifies like a local RSVP.
 */
final class ImipReplyIngest
{
    public const LOG_APPLIED = 'calendar.imip_reply_applied';

    public const LOG_SKIPPED = 'calendar.imip_reply_skipped';

    public const SENDER_NOT_VERIFIED = 'sender_not_verified';

    public const INVALID_CALENDAR = 'invalid_calendar';

    public const METHOD_NOT_SUPPORTED = 'method_not_supported';

    public const ATTENDEE_MISMATCH = 'attendee_mismatch';

    public const ORGANIZER_MISMATCH = 'organizer_mismatch';

    public const EVENT_NOT_FOUND = 'event_not_found';

    public const NOT_AN_ATTENDEE = 'not_an_attendee';

    public const STALE_SEQUENCE = 'stale_sequence';

    public const UNSUPPORTED_STATUS = 'unsupported_status';

    public const RATE_LIMITED = 'rate_limited';

    private const STATUSES = ['ACCEPTED', 'DECLINED', 'TENTATIVE'];

    public function __construct(
        private readonly ImipSenderAuthentication $authentication,
        private readonly VObjectPayloadGuard $payloadGuard,
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly CalendarSchedulingObjects $objects,
        private readonly CalendarSchedulingDeliveryPolicy $deliveryPolicy,
        private readonly ImipReplyRateLimiter $rateLimiter,
        private readonly WgwCalendarBackendFactory $backends,
        private readonly CalendarObjectSearchIndex $searchIndex,
        private readonly EventDispatch $eventDispatch,
    ) {}

    /**
     * @param  string  $owner  username of the mailbox owner (the organizer)
     * @param  string  $trustedServerId  authserv-id of the mailbox's receiving server
     * @param  string  $ics  decoded `text/calendar` part
     * @param  int  $imapUid  for logs only
     */
    public function ingest(string $owner, string $trustedServerId, MailHeaders $headers, string $ics, int $imapUid): ImipReplyOutcome
    {
        $outcome = $this->evaluate($owner, $trustedServerId, $headers, $ics);
        if ($outcome->status === ImipReplyOutcome::SKIPPED) {
            Log::notice(self::LOG_SKIPPED, [
                'owner' => $owner,
                'imap_uid' => $imapUid,
                'uid' => $outcome->uid,
                'reason' => $outcome->reason,
            ]);
        } else {
            Log::info(self::LOG_APPLIED, [
                'owner' => $owner,
                'imap_uid' => $imapUid,
                'uid' => $outcome->uid,
                'changed' => $outcome->status === ImipReplyOutcome::APPLIED,
            ]);
        }

        return $outcome;
    }

    private function evaluate(string $owner, string $trustedServerId, MailHeaders $headers, string $ics): ImipReplyOutcome
    {
        $check = $this->authentication->check($headers, $trustedServerId);
        $sender = $check->sender;
        if ($sender === null) {
            return ImipReplyOutcome::skipped(self::SENDER_NOT_VERIFIED);
        }

        try {
            $reply = $this->payloadGuard->readICalendar($ics, 'calendars', 'notice');
        } catch (\Throwable) {
            return ImipReplyOutcome::skipped(self::INVALID_CALENDAR);
        }
        $shape = $this->replyShape($reply);
        if (is_string($shape)) {
            return ImipReplyOutcome::skipped($shape);
        }
        $uid = $shape['uid'];
        foreach ($shape['components'] as $component) {
            if ($this->addresses->normalizedEmail((string) $component->ATTENDEE) !== $sender->email) {
                return ImipReplyOutcome::skipped(self::ATTENDEE_MISMATCH, $uid);
            }
            $organizer = $this->addresses->principalForMailto((string) ($component->ORGANIZER ?? ''));
            if ($organizer === null || (string) $organizer->uri !== 'principals/'.$owner) {
                return ImipReplyOutcome::skipped(self::ORGANIZER_MISMATCH, $uid);
            }
            $status = strtoupper(trim((string) ($component->ATTENDEE['PARTSTAT'] ?? '')));
            if (! in_array($status, self::STATUSES, true)) {
                return ImipReplyOutcome::skipped(self::UNSUPPORTED_STATUS, $uid);
            }
        }
        if (! $this->rateLimiter->allows($owner, $sender->email)) {
            return ImipReplyOutcome::skipped(self::RATE_LIMITED, $uid);
        }

        $outcome = DB::connection('wgw')->transaction(function () use ($owner, $sender, $reply, $shape, $uid): ImipReplyOutcome {
            CalendarObject::query()->where('uid', $uid)->lockForUpdate()->get();

            return $this->apply($owner, $sender, $reply, $shape['components'], $uid);
        });
        if ($outcome->status === ImipReplyOutcome::APPLIED) {
            $this->rateLimiter->hit($owner, $sender->email);
        }

        return $outcome;
    }

    /**
     * METHOD:REPLY, one UID, only VEVENT (and VTIMEZONE), exactly one
     * ATTENDEE per VEVENT.
     *
     * @return array{uid: string, components: list<VEvent>}|string
     */
    private function replyShape(VCalendar $reply): array|string
    {
        $method = strtoupper(trim((string) ($reply->METHOD ?? '')));
        if ($method !== 'REPLY') {
            return self::METHOD_NOT_SUPPORTED;
        }
        $uid = null;
        $components = [];
        foreach ($reply->getComponents() as $component) {
            if ($component->name === 'VTIMEZONE') {
                continue;
            }
            if (! $component instanceof VEvent) {
                return self::INVALID_CALENDAR;
            }
            $componentUid = trim((string) ($component->UID ?? ''));
            if ($componentUid === '' || ($uid !== null && $componentUid !== $uid)) {
                return self::INVALID_CALENDAR;
            }
            $uid = $componentUid;
            if (count($component->select('ATTENDEE')) !== 1) {
                return self::ATTENDEE_MISMATCH;
            }
            $components[] = $component;
        }
        if ($uid === null || $components === []) {
            return self::INVALID_CALENDAR;
        }

        return ['uid' => $uid, 'components' => $components];
    }

    /**
     * @param  list<VEvent>  $components
     */
    private function apply(string $owner, MailAddress $sender, VCalendar $reply, array $components, string $uid): ImipReplyOutcome
    {
        $event = $this->objects->organizerEvent($owner, $uid);
        $current = $event !== null ? $this->objects->parse($event['object']) : null;
        if ($event === null || $current === null) {
            return ImipReplyOutcome::skipped(self::EVENT_NOT_FOUND, $uid);
        }
        if (! $this->deliveryPolicy->allows($this->message($reply, $uid, 'mailto:'.$sender->email, $sender, $owner), 'principals/'.$owner, $current)) {
            return ImipReplyOutcome::skipped(self::NOT_AN_ATTENDEE, $uid);
        }

        $instances = $this->instancesByRecurrence($current);
        $master = $instances['master'] ?? null;
        $storedAddress = null;
        foreach ($components as $component) {
            $key = $this->recurrenceKey($component);
            $target = $instances[$key] ?? null;
            if ($target === null) {
                // A reply for an occurrence that has no exception yet: the
                // broker copies it from the recurring master.
                $target = ($master !== null && isset($master->RRULE)) ? $master : null;
            }
            $address = $target !== null ? $this->storedAttendee($target, $sender->email) : null;
            if ($address === null || ($storedAddress !== null && $address !== $storedAddress)) {
                return ImipReplyOutcome::skipped(self::NOT_AN_ATTENDEE, $uid);
            }
            $storedAddress = $address;
            $replySequence = isset($component->SEQUENCE) ? (int) $component->SEQUENCE->getValue() : 0;
            $eventSequence = isset($target->SEQUENCE) ? (int) $target->SEQUENCE->getValue() : 0;
            if ($replySequence < $eventSequence) {
                return ImipReplyOutcome::skipped(self::STALE_SEQUENCE, $uid);
            }
            // The organizer's copy records the reply as received (2.0);
            // the sender's own request-status is not copied onto it.
            unset($component->{'REQUEST-STATUS'});
        }
        if ($storedAddress === null) {
            return ImipReplyOutcome::skipped(self::NOT_AN_ATTENDEE, $uid);
        }

        $before = $this->attendeeSnapshot($current);
        $updated = (new Broker)->processMessage($this->message($reply, $uid, $storedAddress, $sender, $owner), clone $current);
        if (! $updated instanceof VCalendar) {
            return ImipReplyOutcome::skipped(self::NOT_AN_ATTENDEE, $uid);
        }
        $after = $this->attendeeSnapshot($updated);
        if (! $this->onlySenderChanged($before, $after, $storedAddress)) {
            return ImipReplyOutcome::skipped(self::NOT_AN_ATTENDEE, $uid);
        }
        if ($this->senderStatuses($before, $storedAddress) === $this->senderStatuses($after, $storedAddress)) {
            return ImipReplyOutcome::unchanged($uid);
        }

        $instance = $event['instance'];
        $object = $event['object'];
        $this->backends->calBackend()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
            $updated->serialize(),
        );
        $this->searchIndex->index((string) $instance->principaluri, (string) $instance->uri, (string) $object->uri);
        $this->notify($owner, $sender, $components[0], $updated, $uid);

        return ImipReplyOutcome::applied($uid);
    }

    private function message(VCalendar $reply, string $uid, string $senderAddress, MailAddress $sender, string $owner): Message
    {
        $message = new Message;
        $message->method = 'REPLY';
        $message->component = 'VEVENT';
        $message->uid = $uid;
        $message->sender = $senderAddress;
        $message->senderName = $sender->displayName !== '' ? $sender->displayName : null;
        $message->recipient = 'mailto:'.$owner;
        $message->message = $reply;

        return $message;
    }

    /**
     * VEVENTs keyed like Sabre's broker: `master`, or the RECURRENCE-ID as a
     * Unix timestamp.
     *
     * @return array<string|int, VEvent>
     */
    private function instancesByRecurrence(VCalendar $calendar): array
    {
        $instances = [];
        foreach ($calendar->select('VEVENT') as $vevent) {
            if ($vevent instanceof VEvent) {
                $instances[$this->recurrenceKey($vevent)] = $vevent;
            }
        }

        return $instances;
    }

    private function recurrenceKey(Component $vevent): string|int
    {
        if (! isset($vevent->{'RECURRENCE-ID'})) {
            return 'master';
        }
        try {
            return $vevent->{'RECURRENCE-ID'}->getDateTime()->getTimestamp();
        } catch (\Throwable) {
            return 'invalid';
        }
    }

    /** The ATTENDEE value as stored on the event for this email, exactly as written. */
    private function storedAttendee(VEvent $vevent, string $email): ?string
    {
        foreach ($vevent->select('ATTENDEE') as $attendee) {
            if ($this->addresses->normalizedEmail((string) $attendee) === $email) {
                return (string) $attendee;
            }
        }

        return null;
    }

    /**
     * Each instance's attendees (value => PARTSTAT).
     *
     * @return array<string|int, array<string, string>>
     */
    private function attendeeSnapshot(VCalendar $calendar): array
    {
        $snapshot = [];
        foreach ($this->instancesByRecurrence($calendar) as $key => $vevent) {
            $row = [];
            foreach ($vevent->select('ATTENDEE') as $attendee) {
                $row[(string) $attendee] = strtoupper((string) ($attendee['PARTSTAT'] ?? 'NEEDS-ACTION'));
            }
            $snapshot[$key] = $row;
        }

        return $snapshot;
    }

    /**
     * Every attendee other than the sender is unchanged on every instance, no
     * attendee was added, and a new exception copies the master's attendees.
     *
     * @param  array<string|int, array<string, string>>  $before
     * @param  array<string|int, array<string, string>>  $after
     */
    private function onlySenderChanged(array $before, array $after, string $senderAddress): bool
    {
        foreach ($after as $key => $attendees) {
            $original = $before[$key] ?? ($before['master'] ?? null);
            if ($original === null || array_keys($attendees) !== array_keys($original)) {
                return false;
            }
            foreach ($attendees as $address => $status) {
                if ($address !== $senderAddress && $status !== $original[$address]) {
                    return false;
                }
            }
        }

        return count(array_diff_key($before, $after)) === 0;
    }

    /**
     * @param  array<string|int, array<string, string>>  $snapshot
     * @return array<string|int, string|null>
     */
    private function senderStatuses(array $snapshot, string $senderAddress): array
    {
        $statuses = [];
        foreach ($snapshot as $key => $attendees) {
            $statuses[$key] = $attendees[$senderAddress] ?? null;
        }

        return $statuses;
    }

    /**
     * The organizer's `calendar.rsvp` notification. The actor is the
     * attendee's email: they have no account here, and the notify listener
     * only needs it to differ from the organizer.
     */
    private function notify(string $owner, MailAddress $sender, VEvent $replied, VCalendar $updated, string $uid): void
    {
        $instances = $this->instancesByRecurrence($updated);
        $shown = $instances[$this->recurrenceKey($replied)] ?? ($instances['master'] ?? null);
        $status = strtoupper(trim((string) ($replied->ATTENDEE['PARTSTAT'] ?? '')));
        $cn = trim((string) ($replied->ATTENDEE['CN'] ?? ''));
        $label = $cn !== '' ? mb_substr($cn, 0, 120) : ($sender->displayName !== '' ? $sender->displayName : $sender->email);
        $this->eventDispatch->fireMutation(
            $sender->email,
            'calendar',
            CalendarRsvpNotify::ACTION,
            'calendars/rsvp/'.$uid,
            [
                'recipients' => [$owner],
                ...CalendarRsvpNotify::eventData(
                    $label,
                    $shown !== null ? trim((string) ($shown->SUMMARY ?? '')) : '',
                    $uid,
                    $status,
                    $this->date($shown, 'DTSTART'),
                    $this->date($shown, 'DTEND'),
                    $sender->email,
                ),
            ],
        );
    }

    private function date(?VEvent $vevent, string $name): ?DateTimeImmutable
    {
        if ($vevent === null || ! isset($vevent->{$name})) {
            return null;
        }
        try {
            $value = $vevent->{$name}->getDateTime();
        } catch (\Throwable) {
            return null;
        }

        return $value instanceof DateTimeInterface ? DateTimeImmutable::createFromInterface($value) : null;
    }
}
