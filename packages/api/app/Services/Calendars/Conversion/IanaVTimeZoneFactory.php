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
    /** Years of transitions before and after today in a generated VTIMEZONE (#1435). */
    private const YEARS_BEFORE = 2;

    private const YEARS_AFTER = 20;

    public static function icsDefinition(string $tzid): ?string
    {
        $tzid = trim($tzid);
        if ($tzid === '') {
            return null;
        }

        // Without a range, icalcreator only covers about two years ahead
        // (TZUNTIL 2028), so a task or series later than that had a VTIMEZONE
        // without rules for its dates.
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $from = $now->setDate((int) $now->format('Y') - self::YEARS_BEFORE, 1, 1)->setTime(0, 0);
        $to = $now->setDate((int) $now->format('Y') + self::YEARS_AFTER, 12, 31)->setTime(23, 59, 59);

        try {
            $ics = IcalCreatorCalendar::factory()->vtimezonePopulate($tzid, [], $from, $to)->createCalendar();
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
