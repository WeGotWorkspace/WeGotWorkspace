<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use App\Services\VObject\ICalendarSeries;
use App\Services\VObject\ICalendarUid;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Component\VTimeZone;
use Sabre\VObject\Reader;

/**
 * Parse an ICS document and group VEVENTs by UID.
 *
 * No HTTP, calendarId, or persist knowledge — #522 can reuse this for
 * remote feed refresh.
 */
final class CalendarIcsSplitSupport
{
    /**
     * @return list<array{uid: string, ics: string}>
     */
    public static function splitUidGroups(string $ics): array
    {
        $document = self::readCalendar($ics);
        $vevents = CalendarConversionSupport::veventsFromCalendar($document);
        if ($vevents === []) {
            return [];
        }

        $timeZones = self::timeZonesByTzid($document);
        $groups = [];
        foreach (ICalendarSeries::groupByUid(
            $vevents,
            static fn (VEvent $vevent): string => ICalendarUid::fromSeed((string) $vevent->serialize()),
        ) as $uid => $group) {
            $eventGroup = array_values(array_filter(
                $group,
                static fn (mixed $component): bool => $component instanceof VEvent,
            ));
            if ($eventGroup === []) {
                continue;
            }

            $groups[] = [
                'uid' => (string) $uid,
                'ics' => self::serializeGroup($eventGroup, $timeZones),
            ];
        }

        return $groups;
    }

    private static function readCalendar(string $ics): VCalendar
    {
        try {
            $document = Reader::read($ics);
        } catch (\Throwable) {
            throw new \InvalidArgumentException('ICS file is unreadable.');
        }

        if (! $document instanceof VCalendar) {
            throw new \InvalidArgumentException('ICS file is unreadable.');
        }

        return $document;
    }

    /**
     * @return array<string, VTimeZone>
     */
    private static function timeZonesByTzid(VCalendar $calendar): array
    {
        $zones = [];
        foreach ($calendar->select('VTIMEZONE') as $component) {
            if (! $component instanceof VTimeZone) {
                continue;
            }
            $tzid = isset($component->TZID) ? trim((string) $component->TZID->getValue()) : '';
            if ($tzid !== '') {
                $zones[$tzid] = $component;
            }
        }

        return $zones;
    }

    /**
     * @param  list<VEvent>  $vevents
     * @param  array<string, VTimeZone>  $timeZones
     */
    private static function serializeGroup(array $vevents, array $timeZones): string
    {
        $parts = ["BEGIN:VCALENDAR\r\nVERSION:2.0"];
        foreach (self::referencedTzids($vevents) as $tzid) {
            if (isset($timeZones[$tzid])) {
                $parts[] = trim($timeZones[$tzid]->serialize());
            }
        }
        foreach ($vevents as $vevent) {
            $parts[] = trim($vevent->serialize());
        }
        $parts[] = 'END:VCALENDAR';

        return implode("\r\n", $parts)."\r\n";
    }

    /**
     * @param  list<VEvent>  $vevents
     * @return list<string>
     */
    private static function referencedTzids(array $vevents): array
    {
        $tzids = [];
        foreach ($vevents as $vevent) {
            foreach (['DTSTART', 'DTEND', 'RECURRENCE-ID', 'EXDATE', 'RDATE'] as $name) {
                foreach ($vevent->select($name) as $property) {
                    $tzid = trim((string) ($property['TZID'] ?? ''));
                    if ($tzid !== '') {
                        $tzids[$tzid] = true;
                    }
                }
            }
        }

        return array_keys($tzids);
    }
}
