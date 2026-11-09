<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use Sabre\VObject\ITip\Message;

/**
 * Email delivery for a CalDAV scheduling message (#1929): hands it to
 * {@see CalendarImipService}, the same composer, caps and settings as the web
 * app, and records the result as the message's schedule status. Callers decide
 * whether the recipient should get mail; this class does not look the
 * recipient up.
 */
final class CalendarDavImipDelivery
{
    public const string SENT_STATUS = '1.1;Scheduling message is sent via iMip';

    public function __construct(
        private readonly CalendarImipService $imip,
    ) {}

    /**
     * True when a mail went out; the schedule status is then 1.1. When the
     * message is skipped (an insignificant change, external invites off, a
     * cap, no mail transport) the status stays as it was.
     */
    public function deliver(string $organizerUsername, Message $message): bool
    {
        // Sabre's own rule: an insignificant change sends no mail.
        if (! $message->significantChange) {
            return false;
        }
        if (! $this->imip->deliver($organizerUsername, $message)) {
            return false;
        }
        $message->scheduleStatus = self::SENT_STATUS;

        return true;
    }
}
