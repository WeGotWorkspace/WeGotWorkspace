<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\CalendarHome;
use Sabre\CalDAV\Schedule\Inbox;
use Sabre\CalDAV\SharedCalendar;
use Sabre\DAV\INode;

/**
 * {@see CalendarHome} whose calendars and inbox carry the narrowed ACLs of
 * {@see AppSharedCalendar} and {@see AppScheduleInbox}.
 */
final class AppCalendarHome extends CalendarHome
{
    /**
     * Sabre documents Calendar, but the home also returns its inbox, outbox and
     * notifications nodes.
     *
     * @return INode
     */
    public function getChild($name)
    {
        return $this->narrow(parent::getChild($name));
    }

    /**
     * @return list<INode>
     */
    public function getChildren(): array
    {
        return array_values(array_map(fn (INode $node): INode => $this->narrow($node), parent::getChildren()));
    }

    private function narrow(INode $node): INode
    {
        if ($node instanceof Inbox && ! $node instanceof AppScheduleInbox) {
            return AppScheduleInbox::fromStock($node);
        }
        if ($node instanceof SharedCalendar && ! $node instanceof AppSharedCalendar) {
            return AppSharedCalendar::fromStock($node, $this->caldavBackend);
        }

        return $node;
    }
}
