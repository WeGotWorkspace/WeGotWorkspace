<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Admin\AdminConstants;
use App\Services\Teams\TeamColleagues;
use Sabre\CalDAV\Backend\BackendInterface;
use Sabre\CalDAV\CalendarHome;
use Sabre\CalDAV\Schedule\Inbox;
use Sabre\CalDAV\SharedCalendar;
use Sabre\DAV\Exception\Forbidden;
use Sabre\DAV\Exception\NotFound;
use Sabre\DAV\INode;
use Sabre\DAV\MkCol;

/**
 * {@see CalendarHome} whose calendars and inbox carry the narrowed ACLs of
 * {@see AppSharedCalendar} and {@see AppScheduleInbox}, plus the collections
 * of the owner's Teams as {@see TeamCalendar} (#2158): native apps only look
 * in this home, so this is the only place they can find them.
 */
final class AppCalendarHome extends CalendarHome
{
    /**
     * @param  array<string, mixed>  $principalInfo
     * @param  string|null  $viewer  the signed-in principal; Team collections show only in their own home
     */
    public function __construct(BackendInterface $caldavBackend, array $principalInfo, private readonly ?string $viewer = null)
    {
        parent::__construct($caldavBackend, $principalInfo);
    }

    /**
     * Sabre documents Calendar, but the home also returns its inbox, outbox and
     * notifications nodes.
     *
     * @return INode
     */
    public function getChild($name)
    {
        $parsed = TeamCollectionName::parse((string) $name);
        if ($parsed !== null) {
            foreach ($this->teamCalendars($parsed['slug']) as $calendar) {
                if ($calendar->getName() === $name) {
                    return $calendar;
                }
            }

            throw new NotFound('Node with name \''.$name.'\' could not be found');
        }

        return $this->narrow(parent::getChild($name));
    }

    /**
     * @return list<INode>
     */
    public function getChildren(): array
    {
        $own = array_values(array_map(fn (INode $node): INode => $this->narrow($node), parent::getChildren()));
        $ownIds = [];
        foreach ($own as $node) {
            if ($node instanceof AppSharedCalendar) {
                $ownIds[$node->calendarId()] = true;
            }
        }

        $team = [];
        foreach ($this->teamSlugs() as $slug) {
            foreach ($this->teamCalendars($slug) as $calendar) {
                $id = $calendar->calendarId();
                if (! isset($ownIds[$id])) {
                    $ownIds[$id] = true;
                    $team[] = $calendar;
                }
            }
        }

        return [...$own, ...$team];
    }

    /**
     * The `team~` names belong to Team collections, so a member's own calendar may not take one.
     *
     * @param  string  $name
     */
    public function createExtendedCollection($name, MkCol $mkCol): void
    {
        if (TeamCollectionName::isReserved((string) $name)) {
            throw new Forbidden('Calendar names starting with "'.TeamCollectionName::PREFIX.'" are reserved for Team collections.');
        }
        parent::createExtendedCollection($name, $mkCol);
    }

    /**
     * Team calendars of the owner's Team `$slug`, with the backend's own filters (API-only kinds
     * and hidden shares) applied to the Team principal.
     *
     * @return list<TeamCalendar>
     */
    private function teamCalendars(string $slug): array
    {
        if (! in_array($slug, $this->teamSlugs(), true)) {
            return [];
        }
        $calendars = [];
        foreach ($this->caldavBackend->getCalendarsForUser(AdminConstants::GROUP_PREFIX.$slug) as $info) {
            $calendars[] = TeamCalendar::forMember($this->caldavBackend, (string) $this->principalInfo['uri'], $slug, $info);
        }

        return $calendars;
    }

    /**
     * Teams the home's owner is a member of, and only while the owner is the one signed in.
     * The root also opens other people's homes for invitation delivery; a Team collection
     * there would let a Team mate save an invitation as that person ({@see TeamCalendar::getOwner()}).
     *
     * @return list<string>
     */
    private function teamSlugs(): array
    {
        $owner = (string) ($this->principalInfo['uri'] ?? '');
        if ($this->viewer !== $owner || ! str_starts_with($owner, 'principals/') || str_starts_with($owner, AdminConstants::GROUP_PREFIX)) {
            return [];
        }

        return app(TeamColleagues::class)->teamSlugsOf(substr($owner, strlen('principals/')));
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
