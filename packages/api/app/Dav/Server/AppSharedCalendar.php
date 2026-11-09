<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\Backend\BackendInterface;
use Sabre\CalDAV\SharedCalendar;

/**
 * {@see SharedCalendar} without Sabre's read-free-busy grant to every signed-in user.
 *
 * Owners, sharees and delegates keep free/busy through {DAV:}read, which aggregates
 * it. Team colleagues get availability only through the scheduling outbox, which
 * applies the Team availability rules (#1907).
 */
final class AppSharedCalendar extends SharedCalendar
{
    private const READ_FREE_BUSY = '{urn:ietf:params:xml:ns:caldav}read-free-busy';

    public static function fromStock(SharedCalendar $calendar, BackendInterface $backend): self
    {
        return new self($backend, $calendar->calendarInfo);
    }

    /**
     * @return list<array{privilege: string, principal: string, protected?: bool}>
     */
    public function getACL()
    {
        return array_values(array_filter(
            parent::getACL(),
            static fn (array $ace): bool => ! ($ace['privilege'] === self::READ_FREE_BUSY
                && $ace['principal'] === '{DAV:}authenticated'),
        ));
    }
}
