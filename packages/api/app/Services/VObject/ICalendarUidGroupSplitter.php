<?php

declare(strict_types=1);

namespace App\Services\VObject;

use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VTimeZone;
use Sabre\VObject\Reader;

/**
 * Parse an ICS document and group one component type (VEVENT or VTODO) by UID.
 *
 * Each group is serialized as its own VCALENDAR with the VTIMEZONEs its date
 * properties reference. Components of the other types are not returned but
 * counted per type (one per UID), so an import can say what it skipped.
 *
 * No HTTP, collection or persist knowledge: Calendar and Tasks import share it,
 * and #522 can reuse it for remote feed refresh.
 */
final class ICalendarUidGroupSplitter
{
    /** Date properties that may carry a TZID, per component type. */
    private const TZID_PROPERTIES = [
        'VEVENT' => ['DTSTART', 'DTEND', 'RECURRENCE-ID', 'EXDATE', 'RDATE'],
        'VTODO' => ['DTSTART', 'DUE', 'COMPLETED', 'RECURRENCE-ID', 'EXDATE', 'RDATE'],
    ];

    /** Component types an import may skip and report. */
    private const COUNTED_COMPONENTS = ['VEVENT', 'VTODO', 'VJOURNAL'];

    /**
     * @param  'VEVENT'|'VTODO'  $componentName
     * @return array{groups: list<array{uid: string, ics: string}>, skipped: array<string, int>}
     *
     * @throws \InvalidArgumentException when the text is not a readable VCALENDAR
     */
    public static function split(string $ics, string $componentName): array
    {
        $document = self::readCalendar($ics);
        $timeZones = self::timeZonesByTzid($document);

        $groups = [];
        foreach (self::groupedComponents($document, $componentName) as $uid => $group) {
            $groups[] = [
                'uid' => (string) $uid,
                'ics' => self::serializeGroup($group, $timeZones, self::TZID_PROPERTIES[$componentName]),
            ];
        }

        $skipped = [];
        foreach (self::COUNTED_COMPONENTS as $other) {
            if ($other !== $componentName) {
                $skipped[$other] = count(self::groupedComponents($document, $other));
            }
        }

        return ['groups' => $groups, 'skipped' => $skipped];
    }

    /**
     * @return array<string, list<Component>>
     */
    private static function groupedComponents(VCalendar $document, string $componentName): array
    {
        $components = [];
        foreach ($document->select($componentName) as $component) {
            if ($component instanceof Component) {
                $components[] = $component;
            }
        }
        if ($components === []) {
            return [];
        }

        return ICalendarSeries::groupByUid(
            $components,
            static fn (Component $component, int $index): string => ICalendarUid::fromSeed($component->serialize()),
        );
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
     * @param  list<Component>  $components
     * @param  array<string, VTimeZone>  $timeZones
     * @param  list<string>  $tzidProperties
     */
    private static function serializeGroup(array $components, array $timeZones, array $tzidProperties): string
    {
        $parts = ["BEGIN:VCALENDAR\r\nVERSION:2.0"];
        foreach (self::referencedTzids($components, $tzidProperties) as $tzid) {
            if (isset($timeZones[$tzid])) {
                $parts[] = trim($timeZones[$tzid]->serialize());
            }
        }
        foreach ($components as $component) {
            $parts[] = trim($component->serialize());
        }
        $parts[] = 'END:VCALENDAR';

        return implode("\r\n", $parts)."\r\n";
    }

    /**
     * @param  list<Component>  $components
     * @param  list<string>  $tzidProperties
     * @return list<string>
     */
    private static function referencedTzids(array $components, array $tzidProperties): array
    {
        $tzids = [];
        foreach ($components as $component) {
            foreach ($tzidProperties as $name) {
                foreach ($component->select($name) as $property) {
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
