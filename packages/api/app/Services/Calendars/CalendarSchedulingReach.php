<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\Teams\TeamColleagues;

/**
 * Whether an iTIP message between two local users is delivered locally (inbox and
 * calendar copy) or treated like one to an external guest (Task #1923).
 *
 * An invite, update or cancel goes out locally when the recipient is the sender's
 * colleague ({@see TeamColleagues::isColleague}, so an admin reaches everyone). An
 * answer from an attendee (REPLY, REFRESH, COUNTER) travels back the way the invite
 * came: locally when the sender is the recipient's colleague. Without that, an
 * attendee outside an admin's Teams could not answer the admin's local invite.
 */
final class CalendarSchedulingReach
{
    private const ATTENDEE_METHODS = ['REPLY', 'REFRESH', 'COUNTER'];

    public function __construct(private readonly TeamColleagues $colleagues) {}

    public function deliversLocally(string $sender, string $recipient, string $method): bool
    {
        return in_array(strtoupper(trim($method)), self::ATTENDEE_METHODS, true)
            ? $this->colleagues->isColleague($recipient, $sender)
            : $this->colleagues->isColleague($sender, $recipient);
    }

    /** A typed address is rewritten to the canonical one only for someone the writer may find. */
    public function mayCanonicalise(string $writer, string $participant): bool
    {
        return $this->colleagues->isColleague($writer, $participant);
    }
}
