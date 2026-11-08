<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Teams\TeamColleagues;
use DateTimeZone;
use Sabre\CalDAV\ICalendar;
use Sabre\CalDAV\Schedule\Plugin as SchedulePlugin;
use Sabre\CalDAV\Xml\Property\ScheduleCalendarTransp;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAV\ICollection;
use Sabre\DAV\IFile;
use Sabre\DAV\IProperties;
use Sabre\DAVACL\Plugin as AclPlugin;
use Sabre\VObject;

/**
 * RFC 6638 scheduling with the Team rule on free/busy (Task #1923).
 *
 * A VFREEBUSY request to the outbox answers for the caller and for people who
 * share a Team with them ({@see TeamColleagues::sharesTeamIgnoringAdminRole}, so
 * admins too). Anyone else gets exactly the answer of an unknown address.
 *
 * Sabre resolves an attendee through a principal-property-search, which this
 * server limits to the signed-in account ({@see AppCalDAVPrincipalCollection::searchPrincipals}),
 * so stock free/busy only ever answered for yourself. The address is resolved
 * here through the principal backend instead; the rest follows Sabre's
 * `getFreeBusyForEmail` (sabre/dav 4.x) step by step. Team availability (#1614)
 * builds on this class.
 */
final class WgwSchedulePlugin extends SchedulePlugin
{
    /** Sabre's answer for an address it cannot resolve. */
    public const UNKNOWN_ADDRESS_STATUS = '3.7;Could not find principal';

    public function __construct(private readonly TeamColleagues $colleagues) {}

    /**
     * @return array{request-status: string, href: string, calendar-data?: VObject\Component\VCalendar}
     */
    protected function getFreeBusyForEmail($email, \DateTimeInterface $start, \DateTimeInterface $end, VObject\Component $request)
    {
        if (str_starts_with($email, 'mailto:')) {
            $email = substr($email, 7);
        }
        $unknown = ['request-status' => self::UNKNOWN_ADDRESS_STATUS, 'href' => 'mailto:'.$email];

        $principalUri = $this->visiblePrincipalUri($email);
        if ($principalUri === null) {
            return $unknown;
        }

        $caldavNS = '{'.self::NS_CALDAV.'}';
        $props = $this->principalPropertiesWithoutAcl($principalUri, [$caldavNS.'calendar-home-set', $caldavNS.'schedule-inbox-URL']);
        if (! isset($props[$caldavNS.'calendar-home-set'])) {
            return ['request-status' => '3.7;No calendar-home-set property found', 'href' => 'mailto:'.$email];
        }
        if (! isset($props[$caldavNS.'schedule-inbox-URL'])) {
            return ['request-status' => '3.7;No schedule-inbox-URL property found', 'href' => 'mailto:'.$email];
        }
        $homeSet = $props[$caldavNS.'calendar-home-set']->getHref();
        $inboxUrl = $props[$caldavNS.'schedule-inbox-URL']->getHref();

        $acl = $this->server->getPlugin('acl');
        if ($acl instanceof AclPlugin) {
            $acl->checkPrivileges($inboxUrl, $caldavNS.'schedule-query-freebusy');
        }

        [$objects, $timeZone] = $this->busyObjects($homeSet, $start, $end);

        $inboxProps = $this->server->getProperties($inboxUrl, [$caldavNS.'calendar-availability']);

        $vcalendar = new VObject\Component\VCalendar;
        $vcalendar->add('METHOD', 'REPLY');

        $generator = new VObject\FreeBusyGenerator;
        $generator->setObjects($objects);
        $generator->setTimeRange($start, $end);
        $generator->setBaseObject($vcalendar);
        $generator->setTimeZone($timeZone);
        if (isset($inboxProps[$caldavNS.'calendar-availability'])) {
            $generator->setVAvailability(VObject\Reader::read($inboxProps[$caldavNS.'calendar-availability']));
        }
        // The generator fills the base object: $vcalendar now holds the VFREEBUSY.
        $generator->getResult();

        $freeBusy = $vcalendar->VFREEBUSY;
        $requested = $request->select('VFREEBUSY')[0] ?? null;
        if ($freeBusy instanceof VObject\Component && $requested instanceof VObject\Component) {
            $freeBusy->add('ATTENDEE', 'mailto:'.$email);
            foreach (['UID', 'ORGANIZER'] as $name) {
                foreach ($requested->select($name) as $property) {
                    if ($property instanceof VObject\Property) {
                        $freeBusy->add(clone $property);
                    }
                }
            }
        }

        return [
            'calendar-data' => $vcalendar,
            'request-status' => '2.0;Success',
            'href' => 'mailto:'.$email,
        ];
    }

    /**
     * Another user's principal properties are not readable to the caller. Sabre's
     * own lookup (a principal search) and local delivery read them with the ACL
     * property filter off; this does the same for a visible principal only.
     *
     * @param  list<string>  $properties
     * @return array<string, mixed>
     */
    private function principalPropertiesWithoutAcl(string $principalUri, array $properties): array
    {
        $acl = $this->server->getPlugin('acl');
        if (! $acl instanceof AclPlugin) {
            return $this->server->getProperties($principalUri, $properties);
        }
        $this->server->removeListener('propFind', [$acl, 'propFind']);
        try {
            return $this->server->getProperties($principalUri, $properties);
        } finally {
            $this->server->on('propFind', [$acl, 'propFind'], 20);
        }
    }

    /**
     * The principal URI for an address when it is the caller or someone who shares
     * a Team with them; null otherwise, including for an unknown address.
     */
    private function visiblePrincipalUri(string $email): ?string
    {
        $acl = $this->server->getPlugin('acl');
        $auth = $this->server->getPlugin('auth');
        if (! $acl instanceof AclPlugin || ! $auth instanceof AuthPlugin) {
            return null;
        }
        $caller = $auth->getCurrentPrincipal();
        $principalUri = $acl->getPrincipalByUri('mailto:'.$email);
        if (! is_string($caller) || ! is_string($principalUri) || $principalUri === '') {
            return null;
        }
        if ($principalUri === $caller) {
            return $principalUri;
        }
        $prefix = 'principals/';
        if (! str_starts_with($caller, $prefix) || ! str_starts_with($principalUri, $prefix)) {
            return null;
        }

        return $this->colleagues->sharesTeamIgnoringAdminRole(substr($caller, strlen($prefix)), substr($principalUri, strlen($prefix)))
            ? $principalUri
            : null;
    }

    /**
     * Events in the time range from every opaque calendar in the home, and the
     * timezone of the last calendar that sets one (as Sabre does).
     *
     * @return array{0: list<string>, 1: DateTimeZone}
     */
    private function busyObjects(string $homeSet, \DateTimeInterface $start, \DateTimeInterface $end): array
    {
        $caldavNS = '{'.self::NS_CALDAV.'}';
        $timeZone = new DateTimeZone('UTC');
        $objects = [];

        $home = $this->server->tree->getNodeForPath($homeSet);
        if (! $home instanceof ICollection) {
            return [$objects, $timeZone];
        }
        foreach ($home->getChildren() as $node) {
            if (! $node instanceof ICalendar || ! $node instanceof IProperties) {
                continue;
            }
            $props = $node->getProperties([$caldavNS.'schedule-calendar-transp', $caldavNS.'calendar-timezone']);
            $transp = $props[$caldavNS.'schedule-calendar-transp'] ?? null;
            if ($transp instanceof ScheduleCalendarTransp && $transp->getValue() === ScheduleCalendarTransp::TRANSPARENT) {
                continue;
            }
            if (isset($props[$caldavNS.'calendar-timezone'])) {
                $document = VObject\Reader::read($props[$caldavNS.'calendar-timezone']);
                $vtimezone = $document instanceof VObject\Component\VCalendar ? $document->VTIMEZONE : null;
                if ($vtimezone !== null) {
                    $timeZone = $vtimezone->getTimeZone();
                }
                $document->destroy();
            }

            $urls = $node->calendarQuery([
                'name' => 'VCALENDAR',
                'comp-filters' => [[
                    'name' => 'VEVENT',
                    'comp-filters' => [],
                    'prop-filters' => [],
                    'is-not-defined' => false,
                    'time-range' => ['start' => $start, 'end' => $end],
                ]],
                'prop-filters' => [],
                'is-not-defined' => false,
                'time-range' => null,
            ]);
            foreach ($urls as $url) {
                $child = $node->getChild($url);
                if ($child instanceof IFile) {
                    $objects[] = (string) $child->get();
                }
            }
        }

        return [$objects, $timeZone];
    }
}
