<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\Backend\BackendInterface;
use Sabre\CalDAV\CalendarObject;

/**
 * An event or task in a {@see TeamCalendar}, owned by the member whose home lists it.
 *
 * Sabre's scheduling reads the owner of the object when it is deleted, to send the
 * cancellation or decline as that member. The ACL is precomputed from the Team row
 * and does not use the owner.
 */
final class TeamCalendarObject extends CalendarObject
{
    /**
     * @param  array<string, mixed>  $calendarInfo
     * @param  array<string, mixed>  $objectData
     */
    public function __construct(BackendInterface $caldavBackend, array $calendarInfo, array $objectData, private readonly string $member)
    {
        parent::__construct($caldavBackend, $calendarInfo, $objectData);
    }

    public function getOwner(): string
    {
        return $this->member;
    }
}
