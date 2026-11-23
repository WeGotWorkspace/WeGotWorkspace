<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\Backend\BackendInterface;
use Sabre\DAV\Exception\Forbidden;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * A Team calendar, task list or notebook as it appears in a member's own calendar
 * home (#2158), under the name {@see TeamCollectionName::make()}.
 *
 * The ACL stays on the Team principal: members get access through their Team
 * membership, exactly as on the canonical path. A collection the Team owns is
 * served as a read-write share, so a member can edit it but cannot share it on
 * or pick it as their default calendar for invitations. A collection shared
 * with the Team keeps the access of that share. Deleting it from a native app
 * is refused: removing a Team collection is an admin action in the web app.
 *
 * {@see getOwner()} is the member whose home lists it. Sabre's scheduling reads
 * the organizer's addresses from the calendar's owner, so an event with
 * attendees that a member saves here sends invitations as that member, like
 * the web app does for Team calendars. The ACL does not use the owner.
 */
final class TeamCalendar extends AppSharedCalendar
{
    private string $member = '';

    /**
     * @param  array<string, mixed>  $calendarInfo  the Team's own instance row
     */
    public static function forMember(BackendInterface $backend, string $memberUri, string $slug, array $calendarInfo): self
    {
        $access = (int) ($calendarInfo['share-access'] ?? SharingPlugin::ACCESS_NOTSHARED);
        if ($access === SharingPlugin::ACCESS_NOTSHARED || $access === SharingPlugin::ACCESS_SHAREDOWNER) {
            $calendarInfo['share-access'] = SharingPlugin::ACCESS_READWRITE;
        }
        $calendarInfo['uri'] = TeamCollectionName::make($slug, (string) $calendarInfo['uri']);

        $calendar = new self($backend, $calendarInfo);
        $calendar->member = $memberUri;

        return $calendar;
    }

    public function getOwner(): string
    {
        return $this->member;
    }

    public function delete(): void
    {
        throw new Forbidden('A Team collection cannot be removed from a calendar app.');
    }
}
