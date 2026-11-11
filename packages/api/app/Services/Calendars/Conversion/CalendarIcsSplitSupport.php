<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use App\Services\VObject\ICalendarUidGroupSplitter;

/**
 * Parse an ICS document and group VEVENTs by UID.
 *
 * Calendar's view of {@see ICalendarUidGroupSplitter}, which Tasks import
 * shares for VTODOs.
 */
final class CalendarIcsSplitSupport
{
    /**
     * @return list<array{uid: string, ics: string}>
     */
    public static function splitUidGroups(string $ics): array
    {
        return ICalendarUidGroupSplitter::split($ics, 'VEVENT')['groups'];
    }
}
