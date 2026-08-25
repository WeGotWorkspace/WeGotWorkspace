<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use Kigkonsult\Icalcreator\Vcalendar as IcalCreatorCalendar;
use Sabre\VObject\Component\VCalendar as SabreCalendar;
use Sabre\VObject\Component\VTimeZone;
use Sabre\VObject\Reader;
use Throwable;

/**
 * Adapter around kigkonsult/icalcreator VTIMEZONE generation.
 */
final class IanaVTimeZoneFactory
{
    public static function icsDefinition(string $tzid): ?string
    {
        $tzid = trim($tzid);
        if ($tzid === '') {
            return null;
        }

        try {
            $ics = IcalCreatorCalendar::factory()->vtimezonePopulate($tzid)->createCalendar();
        } catch (Throwable) {
            return null;
        }

        $parsed = Reader::read($ics);
        if (! $parsed instanceof SabreCalendar) {
            return null;
        }

        foreach ($parsed->select('VTIMEZONE') as $component) {
            if ($component instanceof VTimeZone) {
                return $component->serialize();
            }
        }

        return null;
    }
}
